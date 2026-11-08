import Bottleneck from "bottleneck";

const tcgdexBottleneck = new Bottleneck({
    maxConcurrent: 4
});

const API = 'https://api.tcgdex.net/v2';
const headers = { "Accept": "application/json", "User-Agent": "BlackLotusPress/1.0" };

// Pokémon TCG Live names the promo sets by codes TCGdex does not know.
const SET_ALIASES: Record<string, string> = { 'PR-SV': 'svp', 'PR-SW': 'swshp' };

// A card as sets and searches list it; image is missing for cards TCGdex has no image of.
export interface TcgdexCard {
    id: string;
    localId: string;
    name: string;
    image?: string;
}

async function get<T>(query: string): Promise<T | undefined> {
    const response = await tcgdexBottleneck.schedule(() => fetch(`${API}${query}`, { headers }));
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Looking up ${query} on TCGdex failed (${response.status}): ${await response.text()}`);
    return await response.json() as T;
}

// The id of the set a deck list names by its code, like "OBF" for "sv03".
export async function findTcgdexSet(code: string): Promise<string | undefined> {
    if (SET_ALIASES[code]) return SET_ALIASES[code];
    return (await get<{ id: string }[]>(`/en/sets?abbreviation.official=eq:${encodeURIComponent(code)}`))?.[0]?.id;
}

export async function tcgdexSetCards(lang: string, setId: string): Promise<TcgdexCard[]> {
    return (await get<{ cards: TcgdexCard[] }>(`/${lang}/sets/${encodeURIComponent(setId)}`))?.cards ?? [];
}

let pocketSets: Promise<Set<string>> | undefined;

// TCGdex lists the cards of Pokémon TCG Pocket, a phone game, with the paper ones.
function pocketSetIds(): Promise<Set<string>> {
    if (!pocketSets) {
        pocketSets = get<{ sets: { id: string }[] }>('/en/series/tcgp').then(series => new Set(series?.sets.map(set => set.id) ?? []));
        pocketSets.catch(() => pocketSets = undefined);
    }
    return pocketSets;
}

export async function searchTcgdexCards(lang: string, name: string): Promise<TcgdexCard[]> {
    const [cards, pocket] = await Promise.all([get<TcgdexCard[]>(`/${lang}/cards?name=eq:${encodeURIComponent(name)}`), pocketSetIds()]);
    return (cards ?? []).filter(card => !pocket.has(card.id.slice(0, card.id.lastIndexOf('-'))));
}
