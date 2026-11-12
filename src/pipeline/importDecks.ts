import { randomUUID } from "node:crypto";
import { type ArchidektCard, type ArchidektCategory, type ArchidektDeck, getArchidektDeck } from "../clients/archidekt.js";
import { getMoxfieldDetails, type MoxfieldBoard, type MoxfieldCardDetails, type MoxfieldDeck } from "../clients/moxfield.js";
import { findPrintingInLanguage, findScryfallCards } from "../clients/scryfall.js";
import { type DeckConfig, DeckData, deckSite, isArchidektDeckUrl, MAGIC_LANGUAGES, type OnProgress, type OrderCard, type PlaywrightChannel, type ScryfallCard, switchPrintings } from "../model.js";

type CardSource = Pick<MoxfieldCardDetails, 'id' | 'name' | 'set' | 'scryfall_id' | 'isToken'>;
type DeckEntry = { board: string, quantity: number, source: CardSource, foil: boolean };
type ImportedCard = { card: OrderCard, source: CardSource };

export function toOrderCards(deck: DeckConfig, moxfield: MoxfieldDeck): ImportedCard[] {
    const boards = ['commanders', 'companions', ...deck.data, 'signatureSpells'];

    const entries = boards.flatMap(board => {
        const cards = (moxfield.boards as Partial<Record<string, MoxfieldBoard>>)[board]?.cards ?? {};
        return Object.values(cards)
            .flatMap(card => card.printingData || [card])
            .map(printing => ({ board, quantity: printing.quantity, source: printing.card, foil: printing.finish === 'foil' || printing.finish === 'etched' }));
    });

    if (deck.data.includes(DeckData.Tokens)) {
        moxfield.tokens.filter(token => token.isToken).forEach(token => entries.push({ board: 'tokens', quantity: 1, source: token, foil: false }));
    }

    return entries.map(entry => toImportedCard(deck, entry));
}

// Archidekt has categories instead of boards: the first category of a card decides its board.
export function archidektToOrderCards(deck: DeckConfig, archidekt: ArchidektDeck): ImportedCard[] {
    const categories = new Map(archidekt.categories.map(category => [category.name, category]));
    const entries = archidekt.cards.map(card => {
        const isToken = card.card.oracleCard.types.includes('Token');
        return {
            board: archidektBoard(card, categories.get(card.categories[0] ?? ''), isToken),
            quantity: card.quantity,
            source: { id: String(card.id), name: card.card.oracleCard.name, set: card.card.edition.editioncode, scryfall_id: card.card.uid, isToken },
            foil: card.modifier !== 'Normal'
        };
    });

    return ['commanders', 'companions', ...deck.data]
        .flatMap(board => entries.filter(entry => entry.board === board))
        .map(entry => toImportedCard(deck, entry));
}

function archidektBoard(card: ArchidektCard, category: ArchidektCategory | undefined, isToken: boolean): string {
    if (category?.isPremier) return 'commanders';
    if (card.companion) return 'companions';
    if (category?.includedInDeck === false) return DeckData.Considering;
    if (isToken) return DeckData.Tokens;
    if (category?.name === 'Sideboard') return DeckData.SideBoard;
    return DeckData.MainBoard;
}

function toImportedCard(deck: DeckConfig, { board, quantity, source, foil }: DeckEntry): ImportedCard {
    return {
        card: {
            id: randomUUID(), deck: deck.url, board, name: source.name, quantity, isToken: source.isToken, excluded: false,
            ...(foil ? { foil } : {}),
            imported: { moxfieldId: source.id, quantity }
        },
        source
    };
}

// In the language, the cards take their printings in it where Scryfall has them, and the notes name the others.
export async function importDeck(deck: DeckConfig, channel: PlaywrightChannel, language: string | undefined, onProgress?: OnProgress, signal?: AbortSignal)
    : Promise<{ name: string, cards: OrderCard[], notes: string[] }> {
    const { name, cards } = await importDeckCards(deck, channel, onProgress, signal);
    if (!language) return { name, cards, notes: [] };
    const { printings, notes } = await translatePrintings(cards, language, onProgress, signal);
    return { name, cards: switchPrintings(cards, printings), notes };
}

// The printings of the cards in the language, by the id of the printing each replaces; the note names the cards Scryfall has none for.
export async function translatePrintings(cards: OrderCard[], language: string, onProgress?: OnProgress, signal?: AbortSignal)
    : Promise<{ printings: Record<string, ScryfallCard>, notes: string[] }> {
    const languageName = MAGIC_LANGUAGES.find(([code]) => code === language)?.[1] ?? language;
    const others = [...new Map(cards.flatMap(card => card.printing && card.printing.lang !== language ? [[card.printing.id, card.printing] as const] : [])).values()];
    const printings: Record<string, ScryfallCard> = {};
    const missing = new Set<string>();
    for (const [done, printing] of others.entries()) {
        signal?.throwIfAborted();
        onProgress?.({ type: 'progress', done, total: others.length, message: `Looking up ${printing.name} in ${languageName} on Scryfall` });
        const found = await findPrintingInLanguage(printing, language);
        if (found) printings[printing.id] = found;
        else missing.add(printing.name);
    }

    const names = [...missing];
    const notes = names.length === 0 ? []
        : names.length === 1 ? [`${names[0]} has no ${languageName} printing on Scryfall and stays as it is.`]
            : [`${names.length} cards have no ${languageName} printing on Scryfall and stay as they are: ${names.join(', ')}.`];
    return { printings, notes };
}

async function importDeckCards(deck: DeckConfig, channel: PlaywrightChannel, onProgress?: OnProgress, signal?: AbortSignal): Promise<{ name: string, cards: OrderCard[] }> {
    onProgress?.({ type: 'progress', done: 0, total: 0, message: `Loading the deck from ${deckSite(deck.url)}` });
    if (!isArchidektDeckUrl(deck.url)) {
        const moxfield = await getMoxfieldDetails(deck, channel, signal);
        const { cards } = await withPrintings(toOrderCards(deck, moxfield), onProgress, signal);
        return { name: moxfield.name, cards };
    }

    const archidekt = await getArchidektDeck(deck.url, signal);
    const entries = archidektToOrderCards(deck, archidekt);
    const { cards, tokens } = await withPrintings(entries, onProgress, signal);
    if (!deck.data.includes(DeckData.Tokens)) return { name: archidekt.name, cards };

    // Moxfield lists the tokens a deck makes; for Archidekt they come from Scryfall.
    const inDeck = new Set(entries.map(({ source }) => source.scryfall_id));
    const related = tokens.filter(token => !inDeck.has(token.id)).map(token => toImportedCard(deck, {
        board: DeckData.Tokens, quantity: 1, foil: false,
        source: { id: token.id, name: token.name, set: '', scryfall_id: token.id, isToken: true }
    }));
    const { cards: relatedCards } = await withPrintings(related, onProgress, signal);
    return { name: archidekt.name, cards: [...cards, ...relatedCards] };
}

async function withPrintings(entries: ImportedCard[], onProgress?: OnProgress, signal?: AbortSignal) {
    const sources = [...new Map(entries.map(({ source }) => [source.id, source])).values()];
    let done = 0;
    const { printings, tokens } = await findScryfallCards(sources, source => {
        // Lookups already under way still finish after a cancel, but must not report into the next job.
        if (!signal?.aborted) onProgress?.({ type: 'progress', done: ++done, total: sources.length, message: `Looking up ${source.name} on Scryfall` });
    });
    signal?.throwIfAborted();

    const cards = entries.map(({ card, source }) => {
        const printing = printings.get(source.id);
        return printing ? { ...card, printing, imported: { ...card.imported!, printingId: printing.id } } : card;
    });
    return { cards, tokens };
}
