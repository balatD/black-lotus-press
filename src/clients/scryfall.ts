import type { MoxfieldCardDetails } from "./moxfield.js";
import type { OrderCard, ScryfallCard } from "../model.js";
import Bottleneck from "bottleneck";

const scryfallBottleneck = new Bottleneck({
    maxConcurrent: 5,
    minTime: 200
});

// Scryfall allows two searches and two lookups by name a second. Requests sent 500 ms apart can arrive closer together.
const scryfallSearchBottleneck = new Bottleneck({
    maxConcurrent: 1,
    minTime: 600
});

// After a 429 Scryfall turns the application away for 30 seconds, and asking on regardless may get it banned.
const RATE_LIMIT_PAUSE_MS = 31_000;
let blockedUntil = 0;

async function waitOutBlock() {
    const wait = blockedUntil - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

// Waits inside the limiter, so its other requests wait as well. A second 429 is left to the caller.
function scryfallFetch(limiter: Bottleneck, url: string, init: RequestInit): Promise<Response> {
    return limiter.schedule(async () => {
        await waitOutBlock();
        const response = await fetch(url, init);
        if (response.status !== 429) return response;

        blockedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
        await waitOutBlock();
        return await fetch(url, init);
    });
}

// The image files on *.scryfall.io have no rate limit.
const scryfallImageBottleneck = new Bottleneck({
    maxConcurrent: 10
})

const scryfallUserAgent = "BlackLotusPress/1.0";
const jsonHeaders = { "Accept": "application/json", "User-Agent": scryfallUserAgent };

const PRINTING_FIELDS = ['id', 'oracle_id', 'name', 'set', 'set_name', 'collector_number', 'lang', 'image_status', 'image_uris', 'illustration_id',
    'full_art', 'frame', 'security_stamp', 'promo_types', 'type_line', 'layout',
    'prices', 'released_at', 'border_color', 'frame_effects', 'digital', 'finishes'];
const FACE_FIELDS = ['name', 'oracle_id', 'type_line', 'image_uris', 'illustration_id'];

function pick(source: Record<string, unknown>, fields: string[]) {
    return Object.fromEntries(fields.filter(field => source[field] !== undefined).map(field => [field, source[field]]));
}

// Orders store the printing, so only the fields the tool uses are kept.
export function toPrinting(json: Record<string, unknown>): ScryfallCard {
    const printing = pick(json, PRINTING_FIELDS);
    if (Array.isArray(json.card_faces)) {
        printing.card_faces = json.card_faces.map(face => pick(face, FACE_FIELDS));
    }
    return printing as ScryfallCard;
}

export async function findScryfallCard(card: MoxfieldCardDetails): Promise<ScryfallCard | undefined> {
    let headers = new Headers({
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": scryfallUserAgent
    });

    let response = await scryfallFetch(scryfallBottleneck, `https://api.scryfall.com/cards/${card.scryfall_id}`, { headers });

    if (response.status === 404) {
        response = await scryfallFetch(scryfallSearchBottleneck, `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.name)}&set=${card.set}`, { headers });
        if (response.status === 404) return;
    }

    if (response.status !== 200) {
        throw new Error(`Scryfall lookup of ${card.name} failed (${response.status}): ${await response.text()}`);
    }

    return toPrinting(await response.json() as Record<string, unknown>);
}

// All printings of the card, newest first. Tokens and other extras are included.
export async function searchPrintings(card: Pick<OrderCard, 'name' | 'printing'>): Promise<ScryfallCard[]> {
    // Reversible cards only carry the oracle id on their faces.
    const oracleId = card.printing?.oracle_id ?? card.printing?.card_faces?.[0]?.oracle_id;
    const query = oracleId ? `oracleid:${oracleId}` : `!"${card.name}"`;

    const printings: ScryfallCard[] = [];
    let url: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=desc&include_extras=true`;
    while (url) {
        const pageUrl: string = url;
        const response = await scryfallFetch(scryfallSearchBottleneck, pageUrl, { headers: jsonHeaders });
        if (response.status === 404) break;
        if (!response.ok) {
            throw new Error(`Scryfall search for ${card.name} failed (${response.status}): ${await response.text()}`);
        }

        const page = await response.json() as { data: Record<string, unknown>[], has_more: boolean, next_page?: string };
        printings.push(...page.data.map(toPrinting));
        url = page.has_more ? page.next_page : undefined;
    }

    return printings;
}

// Paper tokens whose name has the words, one per artwork, newest first; the first page of results is plenty to choose from.
export async function searchTokens(name: string): Promise<ScryfallCard[]> {
    const query = `t:token -is:digital ${name}`;
    const response = await scryfallFetch(scryfallSearchBottleneck,
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=art&order=released&dir=desc`, { headers: jsonHeaders });
    if (response.status === 404) return [];
    if (!response.ok) {
        throw new Error(`Scryfall search for tokens named ${name} failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json() as { data: Record<string, unknown>[] }).data.map(toPrinting);
}

export async function fetchScryfallImage(url: string): Promise<Buffer> {
    const response = await scryfallImageBottleneck.schedule(() => fetch(url, {
        headers: {
            "Accept": "image/png,image/*;q=0.9,*/*;q=0.8",
            "User-Agent": scryfallUserAgent
        }
    }));

    if (!response.ok) {
        throw new Error(`Downloading ${url} failed (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
}
