import Bottleneck from "bottleneck";
import { setTimeout } from "node:timers/promises";
import { mpcfillImage } from "../pipeline/packs.js";

const BASE_URL = 'https://mpcfill.com';
const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'BlackLotusPress/1.0' };
const mpcfillBottleneck = new Bottleneck({ maxConcurrent: 1, minTime: 500 });
const RATE_LIMIT_PAUSE_MS = 10_000;
const thumbnailBottleneck = new Bottleneck({ maxConcurrent: 8 });

// Tags whose images do not show the card as it was printed; their children count as well,
// except AI Remaster, which is the printed art upscaled and left to the comparison with the printing.
const UNOFFICIAL_ROOTS = ['Custom Art', 'Altered Art', 'Custom-Made Frame', 'Alternate Name'];
const FAITHFUL = 'AI Remaster';

// An image of MPC Autofill; the identifier is its Google Drive id.
export interface MpcfillCard {
    identifier: string;
    name: string;
    extension: string;
    sourceName: string;
    dpi: number;
    tags: string[];
}

interface Tag {
    name: string;
    children: Tag[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        const response = await mpcfillBottleneck.schedule(() => fetch(`${BASE_URL}${path}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }));
        // Cloudflare turns too many requests in a row away for a while.
        if (response.status === 429 && attempt < 4) {
            await setTimeout(RATE_LIMIT_PAUSE_MS * attempt);
            continue;
        }
        if (!response.ok) throw new Error(`MPC Autofill answered ${response.status} for ${path}`);
        return await response.json() as T;
    }
}

// Loaded once per run; a failed load is tried again next time.
function once<T>(load: () => Promise<T>): () => Promise<T> {
    let result: Promise<T> | undefined;
    return () => result ??= load().catch(error => {
        result = undefined;
        throw error;
    });
}

// The search needs every source to look in.
const sources = once(async () => Object.values((await call<{ results: Record<string, { pk: number }> }>('/2/sources/')).results).map(source => source.pk));

export const unofficialTags = once(async () => {
    const names = new Set<string>();
    const collect = (tag: Tag, inside: boolean) => {
        const unofficial = inside || UNOFFICIAL_ROOTS.includes(tag.name);
        if (unofficial && tag.name !== FAITHFUL) names.add(tag.name);
        tag.children.forEach(child => collect(child, unofficial));
    };
    (await call<{ tags: Tag[] }>('/2/tags/')).tags.forEach(tag => collect(tag, false));
    return names;
});

// No languages means all of them.
async function searchSettings(languages: string[]) {
    return {
        filterSettings: { excludesTags: ['NSFW'], includesTags: [], languages, minimumDPI: 0, maximumDPI: 1500, maximumSize: 30 },
        searchTypeSettings: { fuzzySearch: false, filterCardbacks: false },
        sourceSettings: { sources: (await sources()).map(pk => [pk, true]) }
    };
}

// The images in the order of their ids, without those MPC Autofill no longer has.
async function imagesOf(ids: string[]): Promise<MpcfillCard[]> {
    const found = new Map<string, MpcfillCard>();
    for (let i = 0; i < ids.length; i += 1000) {
        const { results } = await call<{ results: Record<string, MpcfillCard> }>('/2/cards/', { cardIdentifiers: ids.slice(i, i + 1000) });
        Object.values(results).forEach(card => found.set(card.identifier, card));
    }
    return ids.flatMap(id => found.get(id) ?? []);
}

// All images of a card name in a Scryfall language, in the order MPC Autofill ranks them. Double-faced cards are searched by face.
export async function searchMpcfill(query: string, cardType: 'CARD' | 'TOKEN', language: string): Promise<MpcfillCard[]> {
    const settings = await searchSettings([language.startsWith('zh') ? 'ZH' : language.toUpperCase()]);
    const search = await call<{ results: Record<string, Record<string, string[]>> }>('/2/editorSearch/', { queries: [{ query, cardType }], searchSettings: settings });
    return await imagesOf(Object.values(search.results)[0]?.[cardType] ?? []);
}

// MPC Autofill's desktop tool saves its downloads under these names; without one it asks the Google Drive API, which needs an account.
export async function mpcfillFileNames(ids: string[]): Promise<Map<string, string>> {
    return new Map((await imagesOf(ids)).map(image => [image.identifier, `${image.name}.${image.extension}`]));
}

// Every card back of MPC Autofill, in its order.
export const searchCardbacks = once(async () =>
    await imagesOf((await call<{ cardbacks: string[] }>('/2/cardbacks/', { searchSettings: await searchSettings([]) })).cardbacks));

export async function fetchMpcfillThumbnail(id: string): Promise<Buffer> {
    const response = await thumbnailBottleneck.schedule(() => fetch(mpcfillImage(id, 'small'), { headers: { 'User-Agent': headers['User-Agent'] } }));
    if (!response.ok) throw new Error(`The MPC Autofill preview of ${id} could not be downloaded (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
}
