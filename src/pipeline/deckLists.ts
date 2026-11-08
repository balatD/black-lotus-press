import { randomUUID } from "node:crypto";
import { findYgoCards, searchYgoArtworks } from "../clients/ygoprodeck.js";
import { findTcgdexSet, searchTcgdexCards, type TcgdexCard, tcgdexSetCards } from "../clients/tcgdex.js";
import { type DeckConfig, DeckData, type OnProgress, type OrderCard, POKEMON_LANGUAGES, type Tcg, type TcgCard, tcgCardKey } from "../model.js";

export interface YgoEntry {
    board: DeckData;
    passcode: number;
    quantity: number;
}

export interface PtcglEntry {
    quantity: number;
    name: string;
    set: string;
    number: string;
}

// The lines of a list that are no card; they are shown, so a typo does not go unnoticed.
interface Parsed<Entry> {
    entries: Entry[];
    unknown: string[];
}

const YDK_SECTIONS: Record<string, DeckData> = { '#main': DeckData.MainBoard, '#extra': DeckData.Extra, '!side': DeckData.SideBoard };

// A .ydk file, with one passcode per copy, or a ydke:// link as EDOPro and Dueling Nexus share decks.
export function parseYgoList(text: string): Parsed<YgoEntry> {
    const entries: YgoEntry[] = [];
    const add = (board: DeckData, passcode: number) => {
        const entry = entries.find(existing => existing.board === board && existing.passcode === passcode);
        if (entry) entry.quantity++;
        else entries.push({ board, passcode, quantity: 1 });
    };

    const trimmed = text.trim();
    if (trimmed.startsWith('ydke://')) {
        const sections = trimmed.slice('ydke://'.length).split('!').slice(0, 3).map(part => Buffer.from(part, 'base64'));
        if (sections.some(bytes => bytes.length % 4 !== 0)) return { entries: [], unknown: [trimmed] };
        sections.forEach((bytes, index) => {
            for (let offset = 0; offset < bytes.length; offset += 4) add([DeckData.MainBoard, DeckData.Extra, DeckData.SideBoard][index]!, bytes.readUInt32LE(offset));
        });
        return { entries, unknown: [] };
    }

    const unknown: string[] = [];
    let board = DeckData.MainBoard;
    for (const line of trimmed.split(/\r?\n/).map(line => line.trim())) {
        if (YDK_SECTIONS[line]) board = YDK_SECTIONS[line];
        else if (/^\d+$/.test(line)) add(board, Number(line));
        else if (line !== '' && !line.startsWith('#')) unknown.push(line);
    }
    return { entries, unknown };
}

// The basic energies are in the Scarlet & Violet energy set in this order; exports name them in several ways.
const ENERGIES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const ENERGY_SYMBOLS = 'GRWLPFDM';

function basicEnergy(name: string) {
    const match = name.match(/^(?:Basic\s+)?(?:\{([GRWLPFDM])\}|(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal))\s+Energy$/i);
    if (!match) return undefined;
    const index = match[1] ? ENERGY_SYMBOLS.indexOf(match[1].toUpperCase()) : ENERGIES.findIndex(type => type.toLowerCase() === match[2]!.toLowerCase());
    return { name: `${ENERGIES[index]} Energy`, number: String(index + 1) };
}

// The export of Pokémon TCG Live and Limitless: "4 Charizard ex OBF 125". Its section totals count different cards, not copies, so they are skipped.
export function parsePtcgl(text: string): Parsed<PtcglEntry> {
    const entries: PtcglEntry[] = [];
    const unknown: string[] = [];
    for (const line of text.split(/\r?\n/).map(line => line.trim())) {
        if (line === '' || /^(Pokémon|Pokemon|Trainer|Energy|Total Cards)\s*:/i.test(line)) continue;

        const counted = line.match(/^(\d+)\s+(.+)$/);
        const card = counted?.[2]!.match(/^(.+?)\s+([A-Z][A-Z0-9-]*)\s+(\w*\d\w*)$/);
        const energy = counted && basicEnergy(card ? card[1]! : counted[2]!);
        if (!counted || (!card && !energy)) {
            unknown.push(line);
            continue;
        }

        const quantity = Number(counted[1]);
        const entry = energy
            ? { quantity, name: energy.name, set: card?.[2] ?? 'SVE', number: card?.[3] ?? energy.number }
            : { quantity, name: card![1]!, set: card![2]!, number: card![3]! };
        const existing = entries.find(other => other.set === entry.set && other.number === entry.number);
        if (existing) existing.quantity += quantity;
        else entries.push(entry);
    }
    return { entries, unknown };
}

// The id of the entry in the list stands in for the Moxfield id, so updating the list keeps the edits made here.
function listCard(deck: DeckConfig, board: string, name: string, quantity: number, entry: string, tcgCard: TcgCard): OrderCard {
    return {
        id: randomUUID(), deck: deck.url, board, name, quantity, isToken: false, excluded: false, tcgCard,
        imported: { moxfieldId: entry, quantity, printingId: tcgCardKey(tcgCard) }
    };
}

// The cards of a pasted Yu-Gi-Oh or Pokémon list, and notes on the lines that were not found or print from another image.
export async function importDeckList(deck: DeckConfig, tcg: Tcg, language: string, onProgress?: OnProgress, signal?: AbortSignal): Promise<{ cards: OrderCard[], notes: string[] }> {
    return tcg === 'yugioh' ? await importYgoList(deck, onProgress, signal) : await importPokemonList(deck, language, onProgress, signal);
}

async function importYgoList(deck: DeckConfig, onProgress?: OnProgress, signal?: AbortSignal) {
    const { entries, unknown } = parseYgoList(deck.list ?? '');
    const wanted = entries.filter(entry => deck.data.includes(entry.board));
    onProgress?.({ type: 'progress', done: 0, total: 0, message: 'Looking up the cards on YGOPRODeck' });
    const found = wanted.length > 0 ? await findYgoCards([...new Set(wanted.map(entry => entry.passcode))]) : [];
    signal?.throwIfAborted();

    const notes = unknown.map(line => `The line "${line}" is no passcode.`);
    const cards: OrderCard[] = [];
    for (const entry of wanted) {
        const card = found.find(candidate => candidate.id === entry.passcode || candidate.card_images.some(image => image.id === entry.passcode));
        if (!card) {
            notes.push(`YGOPRODeck does not know the passcode ${entry.passcode}.`);
            continue;
        }
        const image = card.card_images.find(candidate => candidate.id === entry.passcode) ?? card.card_images[0]!;
        cards.push(listCard(deck, entry.board, card.name, entry.quantity, String(entry.passcode), { tcg: 'yugioh', id: image.id, image: image.image_url }));
    }
    return { cards, notes };
}

async function importPokemonList(deck: DeckConfig, language: string, onProgress?: OnProgress, signal?: AbortSignal) {
    const { entries, unknown } = parsePtcgl(deck.list ?? '');
    // A list names many cards of the same sets, which are each asked for once.
    const requests = new Map<string, Promise<unknown>>();
    const once = <T>(key: string, load: () => Promise<T>) => {
        if (!requests.has(key)) requests.set(key, load());
        return requests.get(key) as Promise<T>;
    };
    const sameNumber = (a: string, b: string) => a.replace(/^0+(?=.)/, '').toLowerCase() === b.replace(/^0+(?=.)/, '').toLowerCase();

    const find = async (entry: PtcglEntry, lang: string): Promise<{ card: TcgdexCard, standIn: boolean } | undefined> => {
        const setId = await once(`set ${entry.set}`, () => findTcgdexSet(entry.set));
        const inSet = setId ? (await once(`${lang} ${setId}`, () => tcgdexSetCards(lang, setId))).find(card => sameNumber(card.localId, entry.number)) : undefined;
        if (inSet?.image) return { card: inSet, standIn: false };
        // Cards without an image of their own, like the basic energies, print as another card of the same name.
        const name = inSet?.name ?? (lang === 'en' ? entry.name : undefined);
        const standIn = name && (await once(`${lang} ${name}`, () => searchTcgdexCards(lang, name))).find(card => card.image);
        return standIn ? { card: standIn, standIn: true } : undefined;
    };

    let done = 0;
    const found = await Promise.all(entries.map(async entry => {
        const own = await find(entry, language);
        const result = own ? { ...own, lang: language } : language === 'en' ? undefined : await find(entry, 'en').then(english => english && { ...english, lang: 'en' });
        if (!signal?.aborted) onProgress?.({ type: 'progress', done: ++done, total: entries.length, message: `Looking up ${entry.name} on TCGdex` });
        return result;
    }));
    signal?.throwIfAborted();

    const notes = unknown.map(line => `The line "${line}" is no card.`);
    const languageName = POKEMON_LANGUAGES.find(([code]) => code === language)?.[1] ?? language;
    const cards: OrderCard[] = [];
    entries.forEach((entry, index) => {
        const label = `${entry.name} ${entry.set} ${entry.number}`;
        const result = found[index];
        if (!result) {
            notes.push(`TCGdex does not know ${label}.`);
            return;
        }
        if (result.standIn) notes.push(`${label} has no image and prints as ${result.card.id}.`);
        else if (result.lang !== language) notes.push(`${label} has no ${languageName} image and prints in English.`);
        const tcgCard: TcgCard = { tcg: 'pokemon', id: result.card.id, lang: result.lang, image: `${result.card.image}/high.png` };
        cards.push(listCard(deck, DeckData.MainBoard, result.card.name, entry.quantity, `${entry.set} ${entry.number}`, tcgCard));
    });
    return { cards, notes };
}

// The other artworks of a Yu-Gi-Oh card, or the printings of a Pokémon card in a language, by the card's name.
export async function searchTcgCards(tcg: Tcg, name: string, language: string): Promise<TcgCard[]> {
    if (tcg === 'yugioh') return await searchYgoArtworks(name);
    return (await searchTcgdexCards(language, name))
        .filter(card => card.image)
        .map(card => ({ tcg: 'pokemon' as const, id: card.id, lang: language, image: `${card.image}/high.png` }));
}
