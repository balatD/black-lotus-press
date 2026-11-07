import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ArchidektDeck } from "../clients/archidekt.js";
import type { MoxfieldDeck } from "../clients/moxfield.js";
import { DeckData, PlaywrightChannel } from "../model.js";
import { archidektToOrderCards, importDeck, toOrderCards } from "./importDecks.js";

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

const archidekt = JSON.parse(await fs.readFile(new URL('./fixtures/archidekt-deck.json', import.meta.url), 'utf-8')) as ArchidektDeck;
const archidektCard = (deck: ArchidektDeck, name: string) => deck.cards.find(card => card.card.oracleCard.name === name)!;

test('archidektToOrderCards lists commanders first, then the selected boards, each card on the board of its first category', () => {
    const entries = archidektToOrderCards({ url: 'https://archidekt.com/decks/17558445', data: [DeckData.MainBoard, DeckData.Tokens, DeckData.Considering] }, archidekt);

    assert.deepEqual(entries.map(({ card }) => [card.board, card.quantity, card.name, card.isToken]), [
        ['commanders', 1, 'Sauron, the Dark Lord', false],
        ['commanders', 1, 'Baba Lysaga, Night Witch', false],
        ['mainboard', 1, 'Dimir Signet', false],
        ['mainboard', 5, 'Swamp', false],
        ['mainboard', 1, 'Barad-dûr', false],
        ['tokens', 1, 'Boo', true],
        ['maybeboard', 1, 'Fabled Passage', false],
        ['maybeboard', 1, 'Vorpal Sword', false]
    ]);
});

test('archidektToOrderCards takes the sideboard only when it is selected, and the companion always', () => {
    const deck = structuredClone(archidekt);
    archidektCard(deck, 'Dimir Signet').companion = true;
    archidektCard(deck, 'Swamp').categories = ['Sideboard'];
    const boards = (data: DeckData[]) => archidektToOrderCards({ url: 'deck', data }, deck).map(({ card }) => `${card.board} ${card.name}`);

    assert.ok(boards([DeckData.MainBoard]).includes('companions Dimir Signet'));
    assert.ok(!boards([DeckData.MainBoard]).some(entry => entry.endsWith('Swamp')));
    assert.ok(boards([DeckData.MainBoard, DeckData.SideBoard]).includes('sideboard Swamp'));
});

test('archidektToOrderCards marks the cards Archidekt has as foil or etched', () => {
    const foils = archidektToOrderCards({ url: 'deck', data: [DeckData.MainBoard] }, archidekt).filter(({ card }) => card.foil).map(({ card }) => card.name);

    assert.deepEqual(foils.sort(), ['Baba Lysaga, Night Witch', 'Barad-dûr', 'Sauron, the Dark Lord']);
});

test('archidektToOrderCards looks up the printing chosen in Archidekt and remembers the deck entry, for later updates', () => {
    const swamp = archidektToOrderCards({ url: 'deck', data: [DeckData.MainBoard] }, archidekt).find(({ card }) => card.name === 'Swamp')!;
    const entry = archidektCard(archidekt, 'Swamp');

    assert.equal(swamp.source.scryfall_id, entry.card.uid);
    assert.equal(swamp.source.set, entry.card.edition.editioncode);
    assert.deepEqual(swamp.card.imported, { moxfieldId: String(entry.id), quantity: 5 });
});

test('importDeck adds the tokens Scryfall relates to the cards of an Archidekt deck, once each and none the deck has already', async t => {
    const ORC_ARMY = '00000000-0000-4000-8000-000000000001';
    const uid = (name: string) => archidektCard(archidekt, name).card.uid;
    const part = (id: string, component: string, name: string) => ({ object: 'related_card', id, component, name, type_line: `Token Creature — ${name}` });
    const related: Record<string, unknown[]> = {
        [uid('Sauron, the Dark Lord')]: [part(ORC_ARMY, 'token', 'Orc Army'), part('00000000-0000-4000-8000-000000000002', 'combo_piece', 'The Ring')],
        [uid('Baba Lysaga, Night Witch')]: [part(ORC_ARMY, 'token', 'Orc Army'), part(uid('Boo'), 'token', 'Boo')]
    };
    const requested: string[][] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
        if (url === 'https://archidekt.com/api/decks/17558445/') return Response.json(archidekt);
        const ids = (JSON.parse(String(init!.body)) as { identifiers: { id: string }[] }).identifiers.map(identifier => identifier.id);
        requested.push(ids);
        return Response.json({ data: ids.map(id => ({ id, name: id, set: 'tst', collector_number: '1', lang: 'en', all_parts: related[id] })) });
    });

    const { name, cards } = await importDeck({ url: 'https://archidekt.com/decks/17558445/sauron', data: [DeckData.MainBoard, DeckData.Tokens] }, PlaywrightChannel.Chrome);

    assert.equal(name, 'Sauron Nazgûl Discard');
    assert.deepEqual(cards.filter(card => card.board === 'tokens').map(card => [card.name, card.isToken, card.quantity, card.printing?.id]), [
        ['Boo', true, 1, uid('Boo')],
        ['Orc Army', true, 1, ORC_ARMY]
    ]);
    assert.deepEqual(requested[1], [ORC_ARMY]);
});
