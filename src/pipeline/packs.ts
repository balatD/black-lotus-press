import { type Adjustments, combineAdjustments, type Order, type OrderCard, type ScryfallCard, type ScryfallImageUris, type Shop } from "../model.js";

export const CARDS_PER_PACK = 55;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const PACK_PRICE_EUR = 19.95;
export const BLANK_FILE = 'blank.jpg';

// notmpc.eu sells decks of up to these many cards; the prices are those for one to five identical decks.
export const NOTMPC_DECKS: [size: number, eur: number][] = [
    [18, 10.85], [36, 14.09], [55, 16.88], [72, 21.69], [90, 25.88], [108, 29.97], [126, 35.78], [144, 41.58],
    [162, 45.77], [180, 49.95], [198, 54.09], [216, 58.28], [234, 64.08], [396, 98.28], [504, 121.37], [612, 144.54]
];

// printerstudio.de's decks on Standard (glatt) stock, likewise for one to five identical decks.
export const PRINTERSTUDIO_DECKS: [size: number, eur: number][] = [
    [18, 10.95], [36, 14.75], [54, 18.10], [72, 21.70], [90, 26.50], [108, 31.30], [126, 36.15], [144, 40.95],
    [162, 45.75], [180, 50.55], [198, 55.35], [216, 60.15], [234, 64.95], [396, 98.25], [504, 120.90], [612, 143.45]
];

// The shops that print decks of several sizes instead of meinspiel's packs.
export type DeckShop = Exclude<Shop, 'meinspiel'>;

const DECKS: Record<DeckShop, [size: number, eur: number][]> = { notmpc: NOTMPC_DECKS, printerstudio: PRINTERSTUDIO_DECKS };

export interface Slot {
    front: string;
    back: string;
    // Missing for blank cards.
    cardId?: string;
}

export type FaceSource =
    | { type: 'scryfall', printing: ScryfallCard, face: 'front' | 'back' }
    | { type: 'custom', image: string }
    | { type: 'mpcfill', id: string }
    | { type: 'cardback', driveId: string }
    | { type: 'blank' };

export interface Face {
    // The print image: the base image with the adjustments applied, in CMYK.
    file: string;
    source: FaceSource;
    // Download, post-processing and upscaling, shared by every adjustment of the same image. Blank cards have none.
    base?: string;
    adjustments?: Adjustments;
}

export type PackOrder = Pick<Order, 'cards' | 'cardBack' | 'adjustments' | 'shop'>;

export interface DroppedToken {
    card: OrderCard;
    copies: number;
}

export function faceImageUris(printing: ScryfallCard, face: 'front' | 'back'): ScryfallImageUris | undefined {
    if (face === 'front') return printing.image_uris ?? printing.card_faces?.[0]?.image_uris;
    return printing.card_faces?.find(cardFace => cardFace.image_uris?.png.includes('/back/'))?.image_uris;
}

// The name MPC Autofill knows the face by: double-faced cards by the name of each face.
export function faceName(card: Pick<OrderCard, 'name' | 'printing'>, face: 'front' | 'back') {
    const doubleFaced = card.printing !== undefined && faceImageUris(card.printing, 'back') !== undefined;
    return doubleFaced ? card.printing?.card_faces?.[face === 'front' ? 0 : 1]?.name ?? card.name : card.name;
}

// MPC Autofill images have 1/8 inch of bleed around the card: 33 × 30 pixels at 300 dpi.
export const MPCFILL_BLEED = { x: 33 / 816, y: 30 / 1110 };

// Previews MPC Autofill serves of an image: small is 294 × 400 pixels, large 588 × 800.
export function mpcfillImage(id: string, size: 'small' | 'large') {
    return `https://img.mpcautofill.com/${encodeURIComponent(id)}-${size}-google_drive`;
}

export const BLANK_FACE: Face = { file: BLANK_FILE, source: { type: 'blank' } };

// The Google Drive id of an MPC Autofill image or card back; other faces only exist as the app's processed images.
export function driveId(face: Face): string | undefined {
    return face.source.type === 'mpcfill' ? face.source.id : face.source.type === 'cardback' ? face.source.driveId : undefined;
}

function adjustedFace(stem: string, source: FaceSource, adjustments: Adjustments): Face {
    const percent = (value: number) => Math.round(value * 100);
    return {
        file: `${stem}-b${percent(adjustments.brightness)}-c${percent(adjustments.contrast)}.jpg`,
        base: `base-${stem}.jpg`,
        source,
        adjustments
    };
}

// The shared card back always uses the order's adjustments, so all backs look the same.
export function cardBackFace(order: Pick<Order, 'cardBack' | 'adjustments'>): Face {
    return adjustedFace(`cardback-${order.cardBack}`, { type: 'cardback', driveId: order.cardBack }, combineAdjustments(order.adjustments, undefined));
}

// Undefined when the card has neither a printing nor an own image, i.e. it cannot be printed.
export function cardFaces(card: OrderCard, order: Pick<Order, 'cardBack' | 'adjustments'>): { front: Face, back: Face } | undefined {
    const printing = card.printing;
    const adjustments = combineAdjustments(order.adjustments, card.adjustments);
    const scryfall = (face: 'front' | 'back') => adjustedFace(`scryfall-${printing!.id}-${face}`, { type: 'scryfall', printing: printing!, face }, adjustments);
    const custom = (image: string) => adjustedFace(`custom-${image.replace(/\.[^.]+$/, '')}`, { type: 'custom', image }, adjustments);
    const mpcfill = (id: string) => adjustedFace(`mpcfill-${id}`, { type: 'mpcfill', id }, adjustments);

    const front = card.customImage
        ? custom(card.customImage.front)
        : card.mpcfill?.front ? mpcfill(card.mpcfill.front)
        : printing && faceImageUris(printing, 'front') ? scryfall('front') : undefined;
    if (!front) return undefined;

    const back = card.customImage?.back
        ? custom(card.customImage.back)
        : card.mpcfill?.back ? mpcfill(card.mpcfill.back)
        : printing && faceImageUris(printing, 'back') ? scryfall('back') : cardBackFace(order);

    return { front, back };
}

export function buildPacks(order: PackOrder): { packs: Slot[][], droppedTokens: DroppedToken[] } {
    const slots: Slot[] = [];
    const tokens: { slot: Slot, card: OrderCard }[] = [];

    for (const card of order.cards) {
        const faces = cardFaces(card, order);
        if (card.excluded || !faces) continue;

        for (let i = 0; i < card.quantity; i++) {
            const slot = { front: faces.front.file, back: faces.back.file, cardId: card.id };
            if (card.isToken) {
                tokens.push({ slot, card });
            } else {
                slots.push(slot);
            }
        }
    }

    // Tokens only fill the free slots of the last pack, they never start a new one or make it a larger deck.
    const sizes = order.shop === 'meinspiel' ? [CARDS_PER_PACK] : DECKS[order.shop].map(([size]) => size);
    const largest = sizes.at(-1)!;
    const rest = slots.length % largest;
    const freeSlots = rest === 0 ? 0 : sizes.find(size => size >= rest)! - rest;
    slots.push(...tokens.slice(0, freeSlots).map(token => token.slot));

    const droppedTokens: DroppedToken[] = [];
    for (const { card } of tokens.slice(freeSlots)) {
        const dropped = droppedTokens.find(token => token.card.id === card.id);
        if (dropped) {
            dropped.copies++;
        } else {
            droppedTokens.push({ card, copies: 1 });
        }
    }

    const packs: Slot[][] = [];
    for (let i = 0; i < slots.length; i += largest) {
        packs.push(slots.slice(i, i + largest));
    }

    // notmpc and printerstudio take decks with fewer cards than their size, meinspiel's packs always have 55.
    const lastPack = packs.at(-1);
    while (order.shop === 'meinspiel' && lastPack && lastPack.length < CARDS_PER_PACK) {
        lastPack.push({ front: BLANK_FILE, back: cardBackFace(order).file });
    }

    return { packs, droppedTokens };
}

// Hands the blank slots out over the tokens that print, in turn, so the last pack has no blank card left.
export function fillFreeSlots(order: PackOrder): OrderCard[] {
    const blank = buildPacks(order).packs.flat().filter(slot => slot.cardId === undefined).length;
    const printed = order.cards.filter(card => card.isToken && !card.excluded && cardFaces(card, order));
    if (blank === 0 || printed.length === 0) return order.cards;

    return order.cards.map(card => {
        const index = printed.indexOf(card);
        if (index === -1) return card;
        return { ...card, quantity: card.quantity + Math.floor(blank / printed.length) + (index < blank % printed.length ? 1 : 0) };
    });
}

// What the packs print with the images made under these settings, in short. The PDFs themselves differ with every build.
export function packsFingerprint(packs: Slot[][], imagesVersion: string) {
    // FNV-1a
    let hash = 0x811c9dc5;
    for (const char of JSON.stringify([imagesVersion, packs])) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
    return (hash >>> 0).toString(16);
}

// The smallest deck size of the shop that holds these cards, with its price.
export function shopDeck(shop: DeckShop, cards: number) {
    return DECKS[shop].find(([size]) => size >= cards)!;
}

export function packPrice(shop: Shop, cards: number) {
    return shop === 'meinspiel' ? PACK_PRICE_EUR : shopDeck(shop, cards)[1];
}

// Each PDF embeds every distinct image once, so only unique files count.
export function estimatePackBytes(pack: Slot[], sizes: Record<string, number>) {
    const fronts = new Set(pack.map(slot => slot.front));
    const backs = new Set(pack.map(slot => slot.back));
    return [...fronts, ...backs].reduce((total, file) => total + (sizes[file] ?? 0), 0);
}
