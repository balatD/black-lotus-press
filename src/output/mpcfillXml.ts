import path from "node:path";
import { cardsDir } from "../config/paths.js";
import type { Order } from "../model.js";
import { buildPacks, cardBackFace, cardFaces, driveId, type Face, faceName } from "../pipeline/packs.js";
import { escapeXml } from "./notmpcXml.js";

// The stock MPC Autofill's desktop tool takes when none is given; it only knows the stocks by these names.
const STOCK = '(S30) Standard Smooth';

export interface XmlImage {
    // A Google Drive id, or the path of a processed image, which MPC Autofill's desktop tool uploads from disk.
    id: string;
    local: boolean;
    slots: number[];
    query: string;
}

// The cards the order prints, without blank cards, in MPC Autofill's terms. Slots count from 0.
export function mpcfillImages(order: Order): { fronts: XmlImage[], backs: XmlImage[] } {
    const cards = new Map(order.cards.map(card => [card.id, card]));
    const cardBack = cardBackFace(order).file;
    const fronts = new Map<string, XmlImage>();
    const backs = new Map<string, XmlImage>();

    const add = (images: Map<string, XmlImage>, face: Face, slot: number, query: string) => {
        const drive = driveId(face);
        const id = drive ?? path.join(cardsDir(order), face.file);
        const image = images.get(id) ?? { id, local: drive === undefined, slots: [], query };
        image.slots.push(slot);
        images.set(id, image);
    };

    const slots = buildPacks(order).packs.flat().filter(slot => slot.cardId !== undefined);
    slots.forEach((slot, index) => {
        const card = cards.get(slot.cardId!)!;
        const { front, back } = cardFaces(card, order)!;
        // MPC Autofill's queries of tokens start with "t:".
        const query = (side: 'front' | 'back') => `${card.isToken ? 't:' : ''}${faceName(card, side).toLowerCase()}`;
        add(fronts, front, index, query('front'));
        if (back.file !== cardBack) add(backs, back, index, query('back'));
    });

    return { fronts: [...fronts.values()], backs: [...backs.values()] };
}

// An order file for MPC Autofill's desktop tool and its editor on mpcfill.com. `names` are the file names of the
// MPC Autofill images; without one the desktop tool assumes a PNG named after the id, as here.
export function mpcfillXml(order: Order, names: Map<string, string>): string {
    const { fronts, backs } = mpcfillImages(order);
    const name = (image: XmlImage) => image.local ? path.basename(image.id) : names.get(image.id) ?? `${image.id}.png`;
    const cards = (images: XmlImage[]) => images
        .map(image => `    <card><id>${escapeXml(image.id)}</id><slots>${image.slots.join(',')}</slots><name>${escapeXml(name(image))}</name><query>${escapeXml(image.query)}</query></card>\n`)
        .join('');
    const quantity = fronts.reduce((total, image) => total + image.slots.length, 0);

    return `<?xml version="1.0" encoding="UTF-8"?>
<order>
  <details>
    <quantity>${quantity}</quantity>
    <stock>${STOCK}</stock>
    <foil>false</foil>
  </details>
  <fronts>
${cards(fronts)}  </fronts>
${backs.length > 0 ? `  <backs>\n${cards(backs)}  </backs>\n` : ''}  <cardback>${escapeXml(order.cardBack)}</cardback>
</order>
`;
}
