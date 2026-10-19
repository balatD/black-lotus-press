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

// MPC Autofill images have 1/8 inch of bleed around the card: 33 × 30 pixels at 300 dpi.
export const MPCFILL_BLEED = { x: 33 / 816, y: 30 / 1110 };

// Previews MPC Autofill serves of an image: small is 294 × 400 pixels, large 588 × 800.
export function mpcfillImage(id: string, size: 'small' | 'large') {
    return `https://img.mpcautofill.com/${encodeURIComponent(id)}-${size}-google_drive`;
}

export const BLANK_FACE: Face = { file: BLANK_FILE, source: { type: 'blank' } };

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
    const sizes = order.shop === 'notmpc' ? NOTMPC_DECKS.map(([size]) => size) : [CARDS_PER_PACK];
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

    // notmpc takes decks with fewer cards than their size, meinspiel's packs always have 55.
    const lastPack = packs.at(-1);
    while (order.shop === 'meinspiel' && lastPack && lastPack.length < CARDS_PER_PACK) {
        lastPack.push({ front: BLANK_FILE, back: cardBackFace(order).file });
    }

    return { packs, droppedTokens };
}

// The smallest notmpc deck size that holds these cards, with its price.
export function notmpcDeck(cards: number) {
    return NOTMPC_DECKS.find(([size]) => size >= cards)!;
}

export function packPrice(shop: Shop, cards: number) {
    return shop === 'meinspiel' ? PACK_PRICE_EUR : notmpcDeck(cards)[1];
}

// Each PDF embeds every distinct image once, so only unique files count.
export function estimatePackBytes(pack: Slot[], sizes: Record<string, number>) {
    const fronts = new Set(pack.map(slot => slot.front));
    const backs = new Set(pack.map(slot => slot.back));
    return [...fronts, ...backs].reduce((total, file) => total + (sizes[file] ?? 0), 0);
}
