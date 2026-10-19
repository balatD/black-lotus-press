import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DefaultOrder, NO_ADJUSTMENTS, type Order, type OrderCard, type ScryfallCard } from "../model.js";
import { cardsDir, setDataRoot } from "../config/paths.js";
import { mpcfillXml } from "./mpcfillXml.js";

afterEach(() => setDataRoot(process.cwd()));

function uris(id: string, face: 'front' | 'back') {
    const png = `https://cards.scryfall.io/png/${face}/a/b/${id}.png`;
    return { small: png, normal: png, large: png, png, art_crop: png, border_crop: png };
}

const plain: ScryfallCard = { id: 'p1', name: 'Shadowspear', set: 'thb', collector_number: '236', lang: 'en', full_art: false, frame: '2015', type_line: 'Artifact', layout: 'normal', image_uris: uris('p1', 'front') };
const { image_uris: _, ...faceless } = plain;
const dfc: ScryfallCard = {
    ...faceless, id: 'd1', name: 'Delver of Secrets // Insectile Aberration', layout: 'transform',
    card_faces: [{ name: 'Delver of Secrets', type_line: 'Creature', image_uris: uris('d1', 'front') }, { name: 'Insectile Aberration', type_line: 'Creature', image_uris: uris('d1', 'back') }]
};

function card(id: string, quantity: number, options: Partial<OrderCard>): OrderCard {
    return { id, deck: 'deck', board: 'mainboard', name: id, quantity, isToken: false, excluded: false, ...options };
}

test('mpcfillXml lists MPC Autofill images by their id and the other cards by their processed image, without blank cards', () => {
    setDataRoot('/data');
    const order: Order = {
        ...DefaultOrder, name: 'deck', cardBack: 'drive-back', adjustments: NO_ADJUSTMENTS,
        cards: [
            card('island', 2, { name: 'Island', printing: { ...plain, name: 'Island' }, mpcfill: { front: 'drive-island' } }),
            card('spear', 1, { name: 'Shadowspear', printing: plain }),
            card('delver', 1, { name: dfc.name, printing: dfc }),
            card('goblin', 1, { name: 'Goblin', printing: { ...plain, id: 't1', name: 'Goblin' }, isToken: true, mpcfill: { front: 'drive-goblin' } })
        ]
    };
    const local = (file: string) => path.join(cardsDir(order), file);

    assert.equal(mpcfillXml(order, new Map([['drive-island', 'Island (Unsanctioned).png']])), `<?xml version="1.0" encoding="UTF-8"?>
<order>
  <details>
    <quantity>5</quantity>
    <stock>(S30) Standard Smooth</stock>
    <foil>false</foil>
  </details>
  <fronts>
    <card><id>drive-island</id><slots>0,1</slots><name>Island (Unsanctioned).png</name><query>island</query></card>
    <card><id>${local('scryfall-p1-front-b100-c100.jpg')}</id><slots>2</slots><name>scryfall-p1-front-b100-c100.jpg</name><query>shadowspear</query></card>
    <card><id>${local('scryfall-d1-front-b100-c100.jpg')}</id><slots>3</slots><name>scryfall-d1-front-b100-c100.jpg</name><query>delver of secrets</query></card>
    <card><id>drive-goblin</id><slots>4</slots><name>drive-goblin.png</name><query>t:goblin</query></card>
  </fronts>
  <backs>
    <card><id>${local('scryfall-d1-back-b100-c100.jpg')}</id><slots>3</slots><name>scryfall-d1-back-b100-c100.jpg</name><query>insectile aberration</query></card>
  </backs>
  <cardback>drive-back</cardback>
</order>
`);
});

test('mpcfillXml leaves out the backs when every card has the card back, and escapes what XML cannot hold', () => {
    setDataRoot('/data');
    const order: Order = { ...DefaultOrder, name: 'R&D', cardBack: 'drive-back', cards: [card('island', 1, { name: 'Island', mpcfill: { front: 'drive-island' } })] };

    const xml = mpcfillXml(order, new Map([['drive-island', 'Island <Lands & More>.png']]));

    assert.match(xml, /<name>Island &lt;Lands &amp; More&gt;\.png<\/name>/);
    assert.doesNotMatch(xml, /<backs>/);
});
