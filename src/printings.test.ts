import { test } from "node:test";
import assert from "node:assert/strict";
import { DeckData, DefaultOrder, type OrderCard, type ScryfallCard } from "./model.js";
import { filterPrintings, printedValue, printingPrice, printingStyles, sortPrintings } from "./printings.js";

function printing(id: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
    return { id, name: 'Sol Ring', set: id, set_name: `Set ${id}`, collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Artifact', layout: 'normal', ...extra };
}

const all = { query: '', styles: [], pricedOnly: false, paperOnly: false, nonfoilOnly: false };

test('printingPrice prefers the euro price and falls back to dollars, then to foil prices', () => {
    assert.deepEqual(printingPrice(printing('a', { prices: { eur: '0.45', usd: '0.60' } })), { amount: 0.45, currency: 'EUR', foil: false });
    assert.deepEqual(printingPrice(printing('a', { prices: { eur: null, usd: '0.60' } })), { amount: 0.6, currency: 'USD', foil: false });
    assert.deepEqual(printingPrice(printing('a', { prices: { eur: null, usd: null, eur_foil: '89.00', usd_foil: '120.00' } })), { amount: 89, currency: 'EUR', foil: true });
    assert.equal(printingPrice(printing('a', { prices: { eur: null, usd: null } })), undefined);
    assert.equal(printingPrice(printing('a')), undefined);
});

test('printingStyles recognises the special frames', () => {
    assert.deepEqual(printingStyles(printing('a', { border_color: 'borderless', full_art: true })), ['borderless', 'fullArt']);
    assert.deepEqual(printingStyles(printing('a', { frame_effects: ['extendedart', 'showcase'] })), ['extendedArt', 'showcase']);
    assert.deepEqual(printingStyles(printing('a', { frame: '1997' })), ['oldFrame']);
    assert.deepEqual(printingStyles(printing('a')), []);
});

test('sortPrintings sorts by price and puts printings without a price last', () => {
    const printings = [printing('none'), printing('mid', { prices: { eur: '2.00' } }), printing('low', { prices: { eur: '0.50' } }), printing('high', { prices: { usd: '9.00' } })];

    assert.deepEqual(sortPrintings(printings, 'cheapest').map(p => p.id), ['low', 'mid', 'high', 'none']);
    assert.deepEqual(sortPrintings(printings, 'priciest').map(p => p.id), ['high', 'mid', 'low', 'none']);
});

test('sortPrintings sorts by release date and by set', () => {
    const printings = [printing('b', { released_at: '2020-01-01' }), printing('a', { released_at: '2024-01-01' }), printing('c', { released_at: '1994-01-01' })];

    assert.deepEqual(sortPrintings(printings, 'newest').map(p => p.id), ['a', 'b', 'c']);
    assert.deepEqual(sortPrintings(printings, 'oldest').map(p => p.id), ['c', 'b', 'a']);
    assert.deepEqual(sortPrintings(printings, 'set').map(p => p.id), ['a', 'b', 'c']);
});

test('filterPrintings combines set search, styles, price and paper filters', () => {
    const printings = [
        printing('sld', { set_name: 'Secret Lair Drop', border_color: 'borderless', prices: { eur: '5.00' } }),
        printing('c21', { set_name: 'Commander 2021', frame_effects: ['extendedart'] }),
        printing('ltr', { set_name: 'The Lord of the Rings', digital: true, prices: { usd: '1.00' } })
    ];

    assert.deepEqual(filterPrintings(printings, { ...all, query: 'secret' }).map(p => p.id), ['sld']);
    assert.deepEqual(filterPrintings(printings, { ...all, query: 'C21' }).map(p => p.id), ['c21']);
    assert.deepEqual(filterPrintings(printings, { ...all, styles: ['borderless', 'extendedArt'] }).map(p => p.id), ['sld', 'c21']);
    assert.deepEqual(filterPrintings(printings, { ...all, pricedOnly: true }).map(p => p.id), ['sld', 'ltr']);
    assert.deepEqual(filterPrintings(printings, { ...all, paperOnly: true }).map(p => p.id), ['sld', 'c21']);
});

test('filterPrintings keeps only printings that exist without foil when asked to', () => {
    const printings = [printing('foil', { finishes: ['foil'] }), printing('both', { finishes: ['nonfoil', 'foil'] }), printing('etched', { finishes: ['etched'] })];

    assert.deepEqual(filterPrintings(printings, { ...all, nonfoilOnly: true }).map(p => p.id), ['both']);
});

test('printedValue adds up the euro prices of the printed copies', () => {
    const png = 'https://cards.scryfall.io/png/front/a/b/card.png';
    const images = { small: png, normal: png, large: png, png, art_crop: png, border_crop: png };
    const card = (id: string, quantity: number, prices: NonNullable<ScryfallCard['prices']>, extra: Partial<OrderCard> = {}): OrderCard =>
        ({ id, deck: 'deck', board: 'mainboard', name: id, quantity, isToken: false, excluded: false, printing: printing(id, { prices, image_uris: images }), ...extra });
    const order = {
        ...DefaultOrder,
        decks: [{ url: 'deck', data: [DeckData.MainBoard] }],
        cards: [
            card('priced', 3, { eur: '2.00' }),
            card('dollars only', 1, { usd: '5.00' }),
            card('switched off', 2, { eur: '100.00' }, { excluded: true }),
            card('token', 1, { eur: '0.10' }, { isToken: true })
        ]
    };

    assert.equal(printedValue(order).toFixed(2), '6.10');
});
