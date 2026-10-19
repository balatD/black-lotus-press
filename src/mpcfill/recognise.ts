import sharp from "sharp";
import type { MpcfillImage, OnProgress, OrderCard, ScryfallCard } from "../model.js";
import { faceImageUris, faceName, MPCFILL_BLEED } from "../pipeline/packs.js";
import { fetchScryfallImage, searchPrintings } from "../clients/scryfall.js";
import { fetchMpcfillThumbnail, type MpcfillCard, searchMpcfill, unofficialTags } from "../clients/mpcfill.js";

interface Region {
    left: number;
    top: number;
    width: number;
    height: number;
}

// Inside the art of the usual frames, from the first frame to M15.
const ART_BOX = { left: 0.15, top: 0.14, width: 0.7, height: 0.34 };
// Faithful renders of a printing stay below both distances, other art rarely does.
const CARD_THRESHOLD = 12;
const ART_THRESHOLD = 10;

// Difference hashes of the whole card and of its art, 64 bits each.
export interface ImageHashes {
    card: bigint;
    art: bigint;
}

export interface Recognition {
    // The printings the image shows, the one its name gives first, then the closest.
    printings: string[];
    // Tagged as custom art, altered art, a custom frame or another name.
    unofficial: boolean;
}

export interface KnownPrinting {
    printing: ScryfallCard;
    illustration: string | undefined;
    hashes: ImageHashes;
}

export async function imageHashes(image: Buffer, withBleed: boolean): Promise<ImageHashes> {
    const { width, height } = await sharp(image).metadata();
    const bleedX = withBleed ? Math.round(width * MPCFILL_BLEED.x) : 0;
    const bleedY = withBleed ? Math.round(height * MPCFILL_BLEED.y) : 0;
    const card = { left: bleedX, top: bleedY, width: width - 2 * bleedX, height: height - 2 * bleedY };
    const art = {
        left: card.left + Math.round(card.width * ART_BOX.left),
        top: card.top + Math.round(card.height * ART_BOX.top),
        width: Math.round(card.width * ART_BOX.width),
        height: Math.round(card.height * ART_BOX.height)
    };
    return { card: await differenceHash(image, card), art: await differenceHash(image, art) };
}

// One bit per pixel of an 8 × 8 grey image: whether it is brighter than its right neighbour.
async function differenceHash(image: Buffer, region: Region): Promise<bigint> {
    const pixels = await sharp(image).extract(region).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let hash = 0n;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            hash = (hash << 1n) | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
        }
    }
    return hash;
}

export function hashDistance(a: bigint, b: bigint) {
    let bits = a ^ b;
    let count = 0;
    while (bits) {
        count += Number(bits & 1n);
        bits >>= 1n;
    }
    return count;
}

// Set code and collector number as uploaders write them: "[2X2] {117}", "(M10 146)", "(SLD1494)", or only "{1494}".
export function nameHint(name: string, printings: ScryfallCard[]): ScryfallCard | undefined {
    const compact = (text: string) => text.toLowerCase().replace(/\s+/g, '');
    for (const [, inside, number, alone] of name.matchAll(/[[(]([^\])]*)[\])]\s*(?:\{([^}]*)\})?|\{([^}]*)\}/g)) {
        if (alone !== undefined) {
            const found = printings.filter(printing => printing.collector_number === alone.trim());
            if (found.length === 1) return found[0];
            continue;
        }
        const key = compact(`${inside}${number ?? ''}`);
        const found = printings.find(printing => compact(`${printing.set}${printing.collector_number}`) === key);
        if (found) return found;
    }
    return undefined;
}

// Tags rule out custom images; the rest is compared with every printing. Printings of other art that come close
// are look-alikes, so only those with the closest printing's illustration count.
export function recognise(image: { hashes: ImageHashes, name: string, tags: string[] }, printings: KnownPrinting[], unofficial: Set<string>): Recognition {
    if (image.tags.some(tag => unofficial.has(tag))) return { printings: [], unofficial: true };

    const passing = printings
        .map(known => ({ known, card: hashDistance(image.hashes.card, known.hashes.card), art: hashDistance(image.hashes.art, known.hashes.art) }))
        .filter(match => match.card <= CARD_THRESHOLD && match.art <= ART_THRESHOLD)
        .sort((a, b) => (a.card + a.art) - (b.card + b.art));
    const closest = passing[0];
    if (!closest) return { printings: [], unofficial: false };

    const shown = passing.filter(match => match.known.illustration === closest.known.illustration).map(match => match.known.printing);
    const hinted = nameHint(image.name, shown);
    return { printings: (hinted ? [hinted, ...shown.filter(printing => printing !== hinted)] : shown).map(printing => printing.id), unofficial: false };
}

// Hashes of the images seen so far, by MPC Autofill id or Scryfall printing and face.
const hashCache = new Map<string, Promise<ImageHashes>>();

function cachedHashes(key: string, load: () => Promise<ImageHashes>) {
    let hashes = hashCache.get(key);
    if (!hashes) {
        hashes = load();
        hashCache.set(key, hashes);
        hashes.catch(() => hashCache.delete(key));
    }
    return hashes;
}

function illustration(printing: ScryfallCard, face: 'front' | 'back') {
    return face === 'front' ? printing.illustration_id ?? printing.card_faces?.[0]?.illustration_id : printing.card_faces?.[1]?.illustration_id;
}

// The MPC Autofill images of a face of the card, searched by the face's name for double-faced cards.
export async function findMpcfillImages(card: Pick<OrderCard, 'name' | 'printing' | 'isToken'>, face: 'front' | 'back'): Promise<MpcfillCard[]> {
    return await searchMpcfill(faceName(card, face), card.isToken ? 'TOKEN' : 'CARD', card.printing?.lang ?? 'en');
}

// Printings without a scan that loads are left out of the comparison.
async function knownPrinting(printing: ScryfallCard, face: 'front' | 'back'): Promise<KnownPrinting[]> {
    const url = faceImageUris(printing, face)?.small;
    if (!url) return [];
    const hashes = await cachedHashes(`${printing.id}-${face}`, async () => imageHashes(await fetchScryfallImage(url), false)).catch(() => undefined);
    return hashes ? [{ printing, illustration: illustration(printing, face), hashes }] : [];
}

// Loads the scans ahead of the comparison, so a card with hundreds of printings can show how far it got.
export async function loadPrintingScans(face: 'front' | 'back', printings: ScryfallCard[]): Promise<void> {
    await Promise.all(printings.map(printing => knownPrinting(printing, face)));
}

// Images whose preview cannot be loaded count as not recognised.
export async function recogniseMpcfillImages(face: 'front' | 'back', printings: ScryfallCard[], images: MpcfillCard[]): Promise<Record<string, Recognition>> {
    const unofficial = await unofficialTags();
    const known = (await Promise.all(printings.map(printing => knownPrinting(printing, face)))).flat();

    const results: Record<string, Recognition> = {};
    await Promise.all(images.map(async image => {
        const hashes = await cachedHashes(image.identifier, async () => imageHashes(await fetchMpcfillThumbnail(image.identifier), true)).catch(() => undefined);
        results[image.identifier] = hashes ? recognise({ hashes, name: image.name, tags: image.tags }, known, unofficial) : { printings: [], unofficial: false };
    }));
    return results;
}

// For every printed card without an own or MPC Autofill image: per face, the image of the highest resolution that shows
// the card's printing. Cards without such an image are left out and keep their Scryfall scan.
export async function pickSharpestMpcfillImages(cards: OrderCard[], onProgress?: OnProgress, signal?: AbortSignal): Promise<Record<string, MpcfillImage>> {
    const todo = cards.filter(card => !card.excluded && card.printing && !card.customImage && !card.mpcfill);
    const byPrinting = new Map<string, Promise<MpcfillImage>>();
    const picks: Record<string, MpcfillImage> = {};
    for (const [index, card] of todo.entries()) {
        signal?.throwIfAborted();
        onProgress?.({ type: 'progress', done: index, total: todo.length, message: `Looking for MPC Autofill images of ${card.name}` });
        let images = byPrinting.get(card.printing!.id);
        if (!images) {
            images = sharpestImages(card, card.printing!, signal);
            byPrinting.set(card.printing!.id, images);
        }
        const found = await images;
        if (found.front || found.back) picks[card.id] = found;
    }
    return picks;
}

// The images come sharpest first, so the first one that shows the printing is the one.
async function sharpestImages(card: OrderCard, own: ScryfallCard, signal?: AbortSignal): Promise<MpcfillImage> {
    const found = await searchPrintings(card);
    // The search only finds English printings.
    const printings = found.some(printing => printing.id === own.id) ? found : [own, ...found];
    const images: MpcfillImage = {};
    for (const face of faceImageUris(own, 'back') ? ['front', 'back'] as const : ['front'] as const) {
        const candidates = (await findMpcfillImages(card, face)).sort((a, b) => b.dpi - a.dpi);
        for (let i = 0; i < candidates.length && !images[face]; i += 50) {
            signal?.throwIfAborted();
            const chunk = candidates.slice(i, i + 50);
            const results = await recogniseMpcfillImages(face, printings, chunk);
            const sharpest = chunk.find(image => results[image.identifier]!.printings.includes(own.id));
            if (sharpest) images[face] = sharpest.identifier;
        }
    }
    return images;
}
