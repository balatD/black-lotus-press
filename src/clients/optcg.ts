import Bottleneck from "bottleneck";

const optcgBottleneck = new Bottleneck({
    maxConcurrent: 2,
    minTime: 100
});

const API = 'https://optcgapi.com/api';
const headers = { "Accept": "application/json", "User-Agent": "BlackLotusPress/1.0" };

// One artwork of a card; parallel and alternate arts share the card's id and have ids of their own, like "OP01-001_p1".
export interface OptcgCard {
    card_name: string;
    card_set_id: string;
    card_image_id: string;
    card_image: string;
}

// The cards of the booster sets, the starter decks and the promos each have a path of their own.
function kind(id: string) {
    return /^ST/i.test(id) ? 'decks' : /^P-/i.test(id) ? 'promos' : 'sets';
}

// All artworks of the card with that id, like "OP01-001", the regular one first.
export async function findOnePieceCards(id: string): Promise<OptcgCard[]> {
    const response = await optcgBottleneck.schedule(() => fetch(`${API}/${kind(id)}/card/${encodeURIComponent(id.toUpperCase())}/`, { headers }));
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Looking up ${id} on optcgapi.com failed (${response.status}): ${await response.text()}`);
    const cards = await response.json() as OptcgCard[];
    return cards.filter(card => card.card_image).sort((a, b) => Number(b.card_image_id === b.card_set_id) - Number(a.card_image_id === a.card_set_id));
}

// "Roronoa Zoro (001)" is Roronoa Zoro; the number only tells the cards of the same name apart.
export function onePieceName(card: Pick<OptcgCard, 'card_name'>) {
    return card.card_name.replace(/\s*\((\d+|Parallel)\)/g, '').trim();
}
