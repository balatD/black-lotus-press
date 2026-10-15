import { test } from "node:test";
import assert from "node:assert/strict";
import { changePrinting, DeckData, DefaultOrder, isMoxfieldDeckUrl, isValidOrderName, type OrderCard, replaceDeckCards, type ScryfallCard, updateDeckCards, withDecks } from "./model.js";

function card(id: string, deck: string): OrderCard {
    return { id, deck, board: 'mainboard', name: id, quantity: 1, isToken: false, excluded: false };
}

test('replaceDeckCards keeps the position of the replaced deck', () => {
    const cards = [card('a1', 'A'), card('b1', 'B'), card('b2', 'B'), card('c1', 'C')];

    const result = replaceDeckCards(cards, 'B', [card('b3', 'B')]);

    assert.deepEqual(result.map(c => c.id), ['a1', 'b3', 'c1']);
});

test('replaceDeckCards appends a deck that has no cards yet', () => {
    const result = replaceDeckCards([card('a1', 'A')], 'B', [card('b1', 'B'), card('b2', 'B')]);

    assert.deepEqual(result.map(c => c.id), ['a1', 'b1', 'b2']);
});

test('replaceDeckCards keeps edits that moved other cards between the deck entries', () => {
    const cards = [card('b1', 'B'), card('a1', 'A'), card('b2', 'B')];

    const result = replaceDeckCards(cards, 'B', [card('b3', 'B')]);

    assert.deepEqual(result.map(c => c.id), ['b3', 'a1']);
});

test('isMoxfieldDeckUrl accepts deck links with and without protocol', () => {
    assert.ok(isMoxfieldDeckUrl('https://moxfield.com/decks/L8IJ1yboeU6dqoNqE-78Tw'));
    assert.ok(isMoxfieldDeckUrl('moxfield.com/decks/L8IJ1yboeU6dqoNqE-78Tw'));
    assert.ok(!isMoxfieldDeckUrl('https://archidekt.com/decks/123'));
    assert.ok(!isMoxfieldDeckUrl('not a url'));
});

test('isValidOrderName rejects names that are unsafe as file names', () => {
    assert.ok(isValidOrderName('sauron'));
    assert.ok(isValidOrderName('Sauron Deck 2'));
    for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a:b', ' padded ']) {
        assert.ok(!isValidOrderName(name), name);
    }
});

test('withDecks keeps cards of unchanged decks and drops cards of changed or removed decks', () => {
    const order = {
        ...DefaultOrder,
        decks: [
            { url: 'A', data: [DeckData.MainBoard], name: 'Deck A' },
            { url: 'B', data: [DeckData.MainBoard] },
            { url: 'C', data: [DeckData.MainBoard] }
        ],
        cards: [card('a1', 'A'), card('b1', 'B'), card('c1', 'C')]
    };

    const result = withDecks(order, [
        { url: 'A', data: [DeckData.MainBoard] },
        { url: 'B', data: [DeckData.MainBoard, DeckData.Tokens] },
        { url: 'D', data: [DeckData.MainBoard] }
    ]);

    assert.deepEqual(result.cards.map(c => c.id), ['a1']);
    assert.deepEqual(result.decks.map(deck => deck.name ?? deck.url), ['Deck A', 'B', 'D']);
});

function imported(id: string, quantity: number, printingId = `${id}-print`): OrderCard {
    return { ...card(id, 'B'), quantity, printing: printing(printingId), imported: { moxfieldId: id, quantity, printingId } };
}

function printing(id: string): ScryfallCard {
    return { id, name: id, set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Creature', layout: 'normal' };
}

test('updateDeckCards keeps local edits of cards that are still in the deck', () => {
    const local = { ...imported('sol', 1), id: 'local-sol', excluded: true, customImage: { front: 'own.png' }, adjustments: { brightness: 1.2, contrast: 1 } };

    const { cards, added, removed, changed } = updateDeckCards([local], 'B', [imported('sol', 1)]);

    assert.deepEqual(cards, [local]);
    assert.deepEqual([added, removed, changed], [0, 0, 0]);
});

test('updateDeckCards takes quantity changes from Moxfield unless only the local quantity was changed', () => {
    const untouched = imported('island', 5);
    const editedLocally = { ...imported('swamp', 4), quantity: 2 };
    const editedBoth = { ...imported('forest', 4), quantity: 2 };

    const { cards, changed } = updateDeckCards([untouched, editedLocally, editedBoth], 'B', [imported('island', 7), imported('swamp', 4), imported('forest', 6)]);

    assert.deepEqual(cards.map(c => [c.name, c.quantity, c.imported?.quantity]), [['island', 7, 7], ['swamp', 2, 4], ['forest', 6, 6]]);
    assert.equal(changed, 2);
});

test('updateDeckCards follows the Moxfield printing unless another printing was picked here', () => {
    const swapped = { ...imported('sol', 1), printing: printing('picked-here') };
    const untouched = imported('mox', 1);

    const { cards } = updateDeckCards([swapped, untouched], 'B', [imported('sol', 1, 'new-sol'), imported('mox', 1, 'new-mox')]);

    assert.deepEqual(cards.map(c => c.printing?.id), ['picked-here', 'new-mox']);
});

test('updateDeckCards removes cards that left the deck and adds new ones after the deck', () => {
    const order = [card('a1', 'A'), imported('stays', 1), imported('leaves', 1), card('c1', 'C')];

    const { cards, added, removed } = updateDeckCards(order, 'B', [imported('stays', 1), imported('new', 2)]);

    assert.deepEqual(cards.map(c => c.name), ['a1', 'stays', 'new', 'c1']);
    assert.deepEqual([added, removed], [1, 1]);
});

test('updateDeckCards matches cards imported before the update existed by board and name', () => {
    const legacy = { ...card('Sol Ring', 'B'), excluded: true, printing: printing('maybe-picked-here') };

    const { cards, added } = updateDeckCards([legacy], 'B', [{ ...imported('Sol Ring', 1), name: 'Sol Ring' }]);

    assert.equal(added, 0);
    assert.equal(cards[0]?.excluded, true);
    assert.equal(cards[0]?.printing?.id, 'maybe-picked-here', 'without import state a picked printing cannot be told apart, so it stays');
    assert.equal(cards[0]?.imported?.moxfieldId, 'Sol Ring');
});

const summary = (cards: OrderCard[]) => cards.map(c => `${c.quantity} ${c.name} ${c.printing?.id}`);

test('changePrinting splits the changed copies into their own entry right after the card', () => {
    const cards = [imported('island', 4, 'A'), imported('swamp', 1)];

    const result = changePrinting(cards, 'island', printing('B'), 1);

    assert.deepEqual(summary(result), ['3 island A', '1 island B', '1 swamp swamp-print']);
    assert.equal(result[0]!.id, 'island');
    assert.notEqual(result[1]!.id, 'island');
    assert.deepEqual(result[1]!.imported, cards[0]!.imported, 'both entries stay tied to the Moxfield entry');
});

test('changePrinting moves copies to an entry of the same card that has the printing already', () => {
    const split = changePrinting([imported('island', 4, 'A')], 'island', printing('B'), 1);

    const more = changePrinting(split, 'island', printing('B'), 2);
    assert.deepEqual(summary(more), ['1 island A', '3 island B']);

    const all = changePrinting(more, 'island', printing('B'), 1);
    assert.deepEqual(summary(all), ['4 island B']);
});

test('changePrinting changes the card itself when all copies change and keeps switched off entries apart', () => {
    assert.deepEqual(summary(changePrinting([imported('island', 2, 'A')], 'island', printing('B'), 2)), ['2 island B']);
    assert.deepEqual(summary(changePrinting([imported('island', 2, 'A')], 'island', printing('A'), 1)), ['2 island A']);

    const off = { ...imported('island', 1, 'B'), id: 'off', excluded: true };
    assert.deepEqual(summary(changePrinting([imported('island', 2, 'A'), off], 'island', printing('B'), 1)), ['1 island A', '1 island B', '1 island B']);
});

test('updateDeckCards keeps the copies of a card split over several printings together', () => {
    const split = changePrinting([imported('island', 4, 'A')], 'island', printing('B'), 1);

    const unchanged = updateDeckCards(split, 'B', [imported('island', 4, 'A')]);
    assert.deepEqual(summary(unchanged.cards), ['3 island A', '1 island B']);
    assert.deepEqual([unchanged.added, unchanged.removed, unchanged.changed], [0, 0, 0]);

    const more = updateDeckCards(split, 'B', [imported('island', 6, 'A')]);
    assert.deepEqual(summary(more.cards), ['5 island A', '1 island B']);
    assert.equal(more.changed, 1);

    const fewer = updateDeckCards(split, 'B', [imported('island', 2, 'A')]);
    assert.deepEqual(summary(fewer.cards), ['2 island A'], 'removed copies come off the last entries first');
});
