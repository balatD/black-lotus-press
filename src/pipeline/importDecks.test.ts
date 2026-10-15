import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { MoxfieldDeck } from "../clients/moxfield.js";
import { DeckData } from "../model.js";
import { toOrderCards } from "./importDecks.js";

const moxfield = JSON.parse(await fs.readFile(new URL('./fixtures/moxfield-deck.json', import.meta.url), 'utf-8')) as MoxfieldDeck;

test('toOrderCards lists commanders first, then the selected boards and the tokens', () => {
    const entries = toOrderCards({ url: 'https://moxfield.com/decks/sauron', data: [DeckData.MainBoard, DeckData.Tokens] }, moxfield);

    assert.deepEqual(entries.map(({ card }) => [card.board, card.quantity, card.name, card.isToken]), [
        ['commanders', 1, 'Sauron, the Dark Lord', false],
        ['mainboard', 1, 'Living Death', false],
        ['mainboard', 1, 'Sol Ring', false],
        ['mainboard', 1, 'Mana Drain', false],
        ['mainboard', 3, 'Mountain', false],
        ['tokens', 1, 'Bird', true],
        ['tokens', 1, 'Bird', true]
    ]);
});

test('toOrderCards uses the exact printing chosen in Moxfield', () => {
    const entries = toOrderCards({ url: 'deck', data: [DeckData.MainBoard] }, moxfield);

    const manaDrain = entries.find(({ card }) => card.name === 'Mana Drain');
    assert.equal(manaDrain?.source.set, '2x2');
});

test('toOrderCards leaves out tokens unless they are selected', () => {
    const entries = toOrderCards({ url: 'deck', data: [DeckData.MainBoard] }, moxfield);

    assert.ok(entries.every(({ card }) => !card.isToken));
});

test('toOrderCards remembers what Moxfield had, for later updates', () => {
    const entries = toOrderCards({ url: 'deck', data: [DeckData.MainBoard] }, moxfield);

    const mountain = entries.find(({ card }) => card.name === 'Mountain')!;
    assert.deepEqual(mountain.card.imported, { moxfieldId: mountain.source.id, quantity: 3 });
});

test('toOrderCards gives every entry its own id and the deck url', () => {
    const entries = toOrderCards({ url: 'deck', data: [DeckData.MainBoard, DeckData.Tokens] }, moxfield);

    assert.equal(new Set(entries.map(({ card }) => card.id)).size, entries.length);
    assert.ok(entries.every(({ card }) => card.deck === 'deck' && !card.excluded));
});

test('toOrderCards marks the cards Moxfield has as foil or etched, also within split printings', () => {
    const deck = structuredClone(moxfield);
    const mainboard = Object.values(deck.boards.mainboard.cards);
    const finish = (name: string, value: string) => Object.assign(mainboard.find(card => card.card.name === name)!, { finish: value });
    finish('Sol Ring', 'foil');
    finish('Living Death', 'etched');
    const manaDrain = mainboard.find(card => card.card.name === 'Mana Drain')!;
    for (const printing of manaDrain.printingData ?? [manaDrain]) Object.assign(printing, { finish: 'foil' });

    const foils = toOrderCards({ url: 'deck', data: [DeckData.MainBoard] }, deck).filter(({ card }) => card.foil).map(({ card }) => card.name);

    assert.deepEqual(foils.sort(), ['Living Death', 'Mana Drain', 'Sol Ring']);
});
