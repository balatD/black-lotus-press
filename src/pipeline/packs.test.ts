import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_ADJUSTMENTS, type OrderCard, type ScryfallCard, type Shop } from "../model.js";
import { BLANK_FILE, buildPacks, cardFaces, CARDS_PER_PACK, estimatePackBytes, packPrice } from "./packs.js";

const BACK = 'cardback-drive1-b100-c100.jpg';

function order(cards: OrderCard[], shop: Shop = 'meinspiel') {
    return { cards, cardBack: 'drive1', adjustments: NO_ADJUSTMENTS, shop };
}

function uris(id: string, face: 'front' | 'back') {
    const png = `https://cards.scryfall.io/png/${face}/a/b/${id}.png`;
    return { small: png, normal: png, large: png, png, art_crop: png, border_crop: png };
}

function printing(id: string, doubleFaced = false): ScryfallCard {
    const base = { id, name: id, set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Creature', layout: 'normal' };
    return doubleFaced
        ? { ...base, layout: 'transform', card_faces: [{ name: 'a', type_line: 'x', image_uris: uris(id, 'front') }, { name: 'b', type_line: 'y', image_uris: uris(id, 'back') }] }
        : { ...base, image_uris: uris(id, 'front') };
}

function card(id: string, quantity: number, options: Partial<OrderCard> = {}): OrderCard {
    return { id, deck: 'deck', board: 'mainboard', name: id, quantity, isToken: false, excluded: false, printing: printing(id), ...options };
}

function tokens(count: number) {
    return Array.from({ length: count }, (_, i) => card(`token${i + 1}`, 1, { isToken: true }));
}

test('buildPacks fills 55-card packs and pads the last one with blanks', () => {
    const { packs } = buildPacks(order([card('island', 99), card('dfc', 1, { printing: printing('dfc', true) })]));

    assert.equal(packs.length, 2);
    assert.ok(packs.every(pack => pack.length === CARDS_PER_PACK));
    assert.deepEqual(packs[0]![0], { front: 'scryfall-island-front-b100-c100.jpg', back: BACK, cardId: 'island' });
    assert.deepEqual(packs[1]![44], { front: 'scryfall-dfc-front-b100-c100.jpg', back: 'scryfall-dfc-back-b100-c100.jpg', cardId: 'dfc' });
    assert.ok(packs[1]!.slice(45).every(slot => slot.front === BLANK_FILE && slot.back === BACK && !slot.cardId));
});

test('buildPacks skips cards without printing or own image and excluded cards', () => {
    const { printing: _, ...missing } = card('missing', 2);
    const { packs } = buildPacks(order([missing, card('excluded', 4, { excluded: true }), card('island', 3)]));

    assert.equal(packs.length, 1);
    assert.deepEqual(packs[0]!.slice(0, 4).map(slot => slot.front), ['scryfall-island-front-b100-c100.jpg', 'scryfall-island-front-b100-c100.jpg', 'scryfall-island-front-b100-c100.jpg', BLANK_FILE]);
});

test('buildPacks returns no packs for an empty order', () => {
    assert.deepEqual(buildPacks(order([])), { packs: [], droppedTokens: [] });
});

test('buildPacks only uses tokens to fill the free slots of the last pack', () => {
    const cards = [card('island', 100), ...tokens(11)];

    const { packs, droppedTokens } = buildPacks(order(cards));

    assert.equal(packs.length, 2);
    assert.deepEqual(packs[1]!.slice(45).map(slot => slot.cardId), tokens(10).map(token => token.id));
    assert.deepEqual(droppedTokens.map(token => [token.card.id, token.copies]), [['token11', 1]]);
});

test('buildPacks keeps all tokens that fit and pads the rest with blanks', () => {
    const { packs, droppedTokens } = buildPacks(order([...tokens(3), card('island', 50)]));

    assert.equal(packs.length, 1);
    assert.deepEqual(packs[0]!.slice(50).map(slot => slot.cardId ?? 'blank'), ['token1', 'token2', 'token3', 'blank', 'blank']);
    assert.deepEqual(droppedTokens, []);
});

test('buildPacks counts dropped copies per token when the cards fill their packs exactly', () => {
    const { packs, droppedTokens } = buildPacks(order([card('island', 55), card('treasure', 3, { isToken: true })]));

    assert.equal(packs.length, 1);
    assert.deepEqual(droppedTokens.map(token => [token.card.id, token.copies]), [['treasure', 3]]);
});

test('buildPacks keeps the order of the card list', () => {
    const { packs } = buildPacks(order([card('b', 1), card('a', 1)]));

    assert.deepEqual(packs[0]!.slice(0, 2).map(slot => slot.cardId), ['b', 'a']);
});

test('buildPacks puts notmpc cards into the smallest deck size that holds them, without blanks', () => {
    const { packs } = buildPacks(order([card('island', 60)], 'notmpc'));

    assert.equal(packs.length, 1);
    assert.equal(packs[0]!.length, 60);
    assert.ok(packs[0]!.every(slot => slot.cardId === 'island'));
});

test('buildPacks fills the free slots of the notmpc deck size with tokens, but never a larger deck size', () => {
    const { packs, droppedTokens } = buildPacks(order([card('island', 60), ...tokens(15)], 'notmpc'));

    assert.equal(packs[0]!.length, 72);
    assert.deepEqual(droppedTokens.map(token => token.card.id), ['token13', 'token14', 'token15']);
});

test('buildPacks splits notmpc orders into decks of 612', () => {
    const { packs } = buildPacks(order([card('island', 700)], 'notmpc'));

    assert.deepEqual(packs.map(pack => pack.length), [612, 88]);
});

test('buildPacks puts printerstudio cards into its deck sizes, where 55 cards already need a deck of 72', () => {
    const { packs, droppedTokens } = buildPacks(order([card('island', 54), ...tokens(2)], 'printerstudio'));

    assert.deepEqual(packs.map(pack => pack.length), [54]);
    assert.deepEqual(droppedTokens.map(token => token.card.id), ['token1', 'token2']);
    assert.deepEqual(buildPacks(order([card('island', 700)], 'printerstudio')).packs.map(pack => pack.length), [612, 88]);
});

test('packPrice is the pack price at meinspiel and the price of the smallest fitting deck size at notmpc and printerstudio', () => {
    assert.equal(packPrice('meinspiel', 55), 19.95);
    assert.equal(packPrice('notmpc', 18), 10.85);
    assert.equal(packPrice('notmpc', 60), 21.69);
    assert.equal(packPrice('notmpc', 612), 144.54);
    assert.equal(packPrice('printerstudio', 54), 18.10);
    assert.equal(packPrice('printerstudio', 100), 31.30);
    assert.equal(packPrice('printerstudio', 612), 143.45);
});

test('cardFaces prefers the own back over the double-faced back over the card back', () => {
    const dfc = printing('dfc', true);
    const files = (options: Partial<OrderCard>) => {
        const faces = cardFaces(card('dfc', 1, options), order([]));
        return faces && [faces.front.file, faces.back.file];
    };

    assert.deepEqual(files({ printing: dfc, customImage: { front: 'abc.png', back: 'def.jpg' } }), ['custom-abc-b100-c100.jpg', 'custom-def-b100-c100.jpg']);
    assert.deepEqual(files({ printing: dfc, customImage: { front: 'abc.png' } }), ['custom-abc-b100-c100.jpg', 'scryfall-dfc-back-b100-c100.jpg']);
    assert.deepEqual(files({ printing: printing('island'), customImage: { front: 'abc.png' } }), ['custom-abc-b100-c100.jpg', BACK]);
});

test('cardFaces prefers own images over MPC Autofill images over Scryfall', () => {
    const dfc = printing('dfc', true);
    const faces = (options: Partial<OrderCard>) => cardFaces(card('dfc', 1, { printing: dfc, ...options }), order([]))!;
    const files = (options: Partial<OrderCard>) => [faces(options).front.file, faces(options).back.file];

    assert.deepEqual(files({ mpcfill: { front: 'drive-f', back: 'drive-b' } }), ['mpcfill-drive-f-b100-c100.jpg', 'mpcfill-drive-b-b100-c100.jpg']);
    assert.deepEqual(files({ mpcfill: { back: 'drive-b' } }), ['scryfall-dfc-front-b100-c100.jpg', 'mpcfill-drive-b-b100-c100.jpg']);
    assert.deepEqual(files({ mpcfill: { front: 'drive-f' }, customImage: { front: 'abc.png' } }), ['custom-abc-b100-c100.jpg', 'scryfall-dfc-back-b100-c100.jpg']);
    assert.deepEqual(faces({ mpcfill: { front: 'drive-f' } }).front.source, { type: 'mpcfill', id: 'drive-f' });
});

test('cardFaces names the source of every face', () => {
    const dfc = printing('dfc', true);
    const faces = cardFaces(card('dfc', 1, { printing: dfc, customImage: { front: 'abc.png' } }), order([]));

    assert.deepEqual(faces?.front.source, { type: 'custom', image: 'abc.png' });
    assert.deepEqual(faces?.back.source, { type: 'scryfall', printing: dfc, face: 'back' });
    assert.deepEqual(cardFaces(card('island', 1), order([]))?.back.source, { type: 'cardback', driveId: 'drive1' });
});

test('cardFaces names print images after the combined adjustments and keeps the card back on the order adjustments', () => {
    const adjusted = card('dfc', 1, { printing: printing('dfc', true), adjustments: { brightness: 1.05, contrast: 1.2 } });
    const faces = cardFaces(adjusted, { cardBack: 'drive1', adjustments: { brightness: 1.1, contrast: 1 } })!;
    const plain = cardFaces(card('island', 1), { cardBack: 'drive1', adjustments: { brightness: 1.1, contrast: 1 } })!;

    assert.equal(faces.front.file, 'scryfall-dfc-front-b116-c120.jpg');
    assert.equal(faces.front.base, 'base-scryfall-dfc-front.jpg');
    assert.deepEqual(faces.front.adjustments, { brightness: 1.16, contrast: 1.2 });
    assert.equal(plain.back.file, 'cardback-drive1-b110-c100.jpg');
});

test('estimatePackBytes counts every distinct front and back once', () => {
    const { packs } = buildPacks(order([card('island', 54), card('dfc', 1, { printing: printing('dfc', true) })]));
    const sizes = { 'scryfall-island-front-b100-c100.jpg': 100, 'scryfall-dfc-front-b100-c100.jpg': 10, 'scryfall-dfc-back-b100-c100.jpg': 1, [BACK]: 1000 };

    assert.equal(estimatePackBytes(packs[0]!, sizes), 1111);
});
