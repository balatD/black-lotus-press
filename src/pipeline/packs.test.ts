import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HOME_PRINT, type HomePrint, NO_ADJUSTMENTS, type OrderCard, type ScryfallCard, type Shop } from "../model.js";
import { BLANK_FILE, buildPacks, cardFaces, CARDS_PER_PACK, fillFreeSlots, packPrice, packsFingerprint } from "./packs.js";

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

test('fillFreeSlots hands the blank slots of the last pack out over the tokens in turn', () => {
    // 45 cards and 6 tokens leave 4 blank slots.
    const filled = fillFreeSlots(order([card('island', 45), ...tokens(6)]));

    assert.deepEqual(filled.filter(c => c.isToken).map(c => c.quantity), [2, 2, 2, 2, 1, 1]);
    const { packs, droppedTokens } = buildPacks(order(filled));
    assert.ok(packs[0]!.every(slot => slot.cardId !== undefined));
    assert.deepEqual(droppedTokens, []);
});

test('fillFreeSlots gives the first tokens one copy more when the slots do not divide evenly and leaves switched-off tokens alone', () => {
    // 50 cards and 2 tokens leave 3 blank slots.
    const filled = fillFreeSlots(order([card('island', 50), ...tokens(2), card('off', 1, { isToken: true, excluded: true })]));

    assert.deepEqual(filled.filter(c => c.isToken).map(c => c.quantity), [3, 2, 1]);
});

test('packsFingerprint stays the same for the same packs and changes with what they print and with the image settings', () => {
    const packs = buildPacks(order([card('island', 60)])).packs;

    assert.equal(packsFingerprint(packs, 'v1'), packsFingerprint(buildPacks(order([card('island', 60)])).packs, 'v1'));
    assert.notEqual(packsFingerprint(packs, 'v1'), packsFingerprint(buildPacks(order([card('island', 59), card('swamp', 1)])).packs, 'v1'));
    assert.notEqual(packsFingerprint(packs, 'v1'), packsFingerprint(packs, 'v2'));
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

    assert.deepEqual(files({ mpcfill: { front: 'drive-f', back: 'drive-b' } }), ['mpcfill-full-drive-f-b100-c100.jpg', 'mpcfill-full-drive-b-b100-c100.jpg']);
    assert.deepEqual(files({ mpcfill: { back: 'drive-b' } }), ['scryfall-dfc-front-b100-c100.jpg', 'mpcfill-full-drive-b-b100-c100.jpg']);
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

function homeOrder(cards: OrderCard[], homePrint: Partial<HomePrint> = {}) {
    return { ...order(cards, 'home'), homePrint: { ...DEFAULT_HOME_PRINT, ...homePrint } };
}

const front = (id: string, face: 'front' | 'back' = 'front') => `scryfall-${id}-${face}-b100-c100.jpg`;

test('buildPacks prints every card at home on pages of the grid, tokens included, and pads the last page with blanks', () => {
    const { packs, droppedTokens } = buildPacks(homeOrder([...tokens(2), card('island', 10)]));

    assert.deepEqual(packs.map(page => page.map(slot => slot.cardId ?? 'blank')), [
        Array(9).fill('island'),
        ['island', 'token1', 'token2', 'blank', 'blank', 'blank', 'blank', 'blank', 'blank']
    ]);
    assert.deepEqual(droppedTokens, []);
    assert.deepEqual(buildPacks(homeOrder([card('island', 4)], { columns: 2, rows: 2 })).packs.map(page => page.length), [4]);
});

test('buildPacks prints both sides of a double-faced card at home as cards next to each other, moving up a card so they share a page', () => {
    const { packs } = buildPacks(homeOrder([card('a', 8), card('dfc', 1, { printing: printing('dfc', true) }), card('b', 1)]));

    assert.deepEqual(packs[0]!.map(slot => slot.front), [...Array(8).fill(front('a')), front('b')]);
    assert.deepEqual(packs[1]!.slice(0, 3).map(slot => slot.front), [front('dfc'), front('dfc', 'back'), BLANK_FILE]);
});

test('buildPacks prints only the tokens or the cards of one deck at home when only those are picked', () => {
    const cards = [card('island', 2), card('swamp', 1, { deck: 'other' }), ...tokens(1)];
    const printed = (cardsPicked: HomePrint['cards']) => buildPacks(homeOrder(cards, { cards: cardsPicked })).packs.flat().flatMap(slot => slot.cardId ?? []);

    assert.deepEqual(printed('tokens'), ['token1']);
    assert.deepEqual(printed({ deck: 'other' }), ['swamp']);
    assert.deepEqual(printed('all'), ['island', 'island', 'swamp', 'token1']);
});

test('fillFreeSlots fills the last page at home with the tokens that take one slot', () => {
    const dfcToken = card('dfc-token', 1, { isToken: true, printing: printing('dfc-token', true) });
    const filled = fillFreeSlots(homeOrder([card('island', 4), ...tokens(1), dfcToken]));

    assert.deepEqual(filled.filter(c => c.isToken).map(c => c.quantity), [3, 1]);
    assert.ok(buildPacks(homeOrder(filled)).packs.flat().every(slot => slot.cardId !== undefined));
});

test('packPrice is nothing for home printing', () => {
    assert.equal(packPrice('home', 9), 0);
});
