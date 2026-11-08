import Bottleneck from "bottleneck";
import type { TcgCard } from "../model.js";

// YGOPRODeck allows 20 requests a second and blocks the IP for an hour above that, so the app stays at half.
const ygoprodeckBottleneck = new Bottleneck({
    maxConcurrent: 1,
    minTime: 100
});

const API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const headers = { "Accept": "application/json", "User-Agent": "BlackLotusPress/1.0" };

// card_images has every artwork when looked up by name, and only the one asked for when looked up by passcode.
export interface YgoCard {
    id: number;
    name: string;
    type: string;
    card_images: { id: number, image_url: string }[];
}

async function cardInfo(query: string): Promise<YgoCard[]> {
    const response = await ygoprodeckBottleneck.schedule(() => fetch(`${API}?${query}`, { headers }));
    // It answers 400 when it knows none of the cards asked for.
    if (response.status === 400) return [];
    if (response.status === 429) throw new Error('YGOPRODeck blocks this computer for an hour after too many requests. Try again later.');
    if (!response.ok) throw new Error(`Looking up cards on YGOPRODeck failed (${response.status}): ${await response.text()}`);
    return (await response.json() as { data: YgoCard[] }).data;
}

// Passcodes YGOPRODeck does not know are left out.
export async function findYgoCards(passcodes: number[]): Promise<YgoCard[]> {
    return await cardInfo(`id=${passcodes.join(',')}`);
}

export async function searchYgoArtworks(name: string): Promise<TcgCard[]> {
    const [card] = await cardInfo(`name=${encodeURIComponent(name)}`);
    return card?.card_images.map(image => ({ tcg: 'yugioh' as const, id: image.id, image: image.image_url })) ?? [];
}
