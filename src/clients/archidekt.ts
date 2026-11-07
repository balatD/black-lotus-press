export type ArchidektDeck = {
    name: string,
    categories: ArchidektCategory[],
    cards: ArchidektCard[]
}

export type ArchidektCategory = {
    name: string,
    isPremier: boolean,
    includedInDeck: boolean
}

export type ArchidektCard = {
    id: number,
    quantity: number,
    categories: string[],
    companion: boolean,
    modifier: 'Normal' | 'Foil' | 'Etched',
    card: {
        // The Scryfall id of the printing.
        uid: string,
        edition: { editioncode: string },
        oracleCard: { name: string, types: string[] }
    }
}

// Archidekt's API answers without a browser, unlike Moxfield's.
export async function getArchidektDeck(url: string, signal?: AbortSignal): Promise<ArchidektDeck> {
    const deckId = url.match(/\/decks\/(\d+)/)?.[1];
    const response = await fetch(`https://archidekt.com/api/decks/${deckId}/`, {
        headers: { "Accept": "application/json", "User-Agent": "BlackLotusPress/1.0" },
        ...(signal ? { signal } : {})
    });
    if (!response.ok) {
        throw new Error(`Loading deck ${deckId} from Archidekt failed (${response.status}): ${await response.text()}`);
    }
    return await response.json() as ArchidektDeck;
}
