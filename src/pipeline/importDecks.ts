import { randomUUID } from "node:crypto";
import { getMoxfieldDetails, type MoxfieldBoard, type MoxfieldCardDetails, type MoxfieldDeck } from "../clients/moxfield.js";
import { findScryfallCards } from "../clients/scryfall.js";
import { type DeckConfig, DeckData, type OnProgress, type OrderCard, type PlaywrightChannel } from "../model.js";

export function toOrderCards(deck: DeckConfig, moxfield: MoxfieldDeck): { card: OrderCard, source: MoxfieldCardDetails }[] {
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

    return entries.map(({ board, quantity, source, foil }) => ({
        card: {
            id: randomUUID(), deck: deck.url, board, name: source.name, quantity, isToken: source.isToken, excluded: false,
            ...(foil ? { foil } : {}),
            imported: { moxfieldId: source.id, quantity }
        },
        source
    }));
}

export async function importDeck(deck: DeckConfig, channel: PlaywrightChannel, onProgress?: OnProgress, signal?: AbortSignal): Promise<{ name: string, cards: OrderCard[] }> {
    onProgress?.({ type: 'progress', done: 0, total: 0, message: 'Loading the deck from Moxfield' });
    const moxfield = await getMoxfieldDetails(deck, channel, signal);
    const entries = toOrderCards(deck, moxfield);

    const sources = [...new Map(entries.map(({ source }) => [source.id, source])).values()];
    let done = 0;
    const printings = await findScryfallCards(sources, source => {
        // Lookups already under way still finish after a cancel, but must not report into the next job.
        if (!signal?.aborted) onProgress?.({ type: 'progress', done: ++done, total: sources.length, message: `Looking up ${source.name} on Scryfall` });
    });
    signal?.throwIfAborted();

    const cards = entries.map(({ card, source }) => {
        const printing = printings.get(source.id);
        return printing ? { ...card, printing, imported: { ...card.imported!, printingId: printing.id } } : card;
    });

    return { name: moxfield.name, cards };
}
