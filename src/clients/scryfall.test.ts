import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { ScryfallCard } from "../model.js";
import { searchPrintings, searchTokens } from "./scryfall.js";

afterEach(() => mock.restoreAll());

function printing(id: string, extra: Partial<ScryfallCard> = {}) {
    return {
        id, oracle_id: 'oracle-1', name: 'Sol Ring', set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Artifact', layout: 'normal',
        prices: { eur: '1.20', usd: '1.50' }, released_at: '2024-11-15', oracle_text: 'dropped', ...extra
    };
}

function mockPages(pages: Record<string, unknown>) {
    const urls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        urls.push(url);
        const page = Object.entries(pages).find(([part]) => url.includes(part))?.[1];
        return page ? Response.json(page) : new Response('{"object":"error"}', { status: 404 });
    });
    return urls;
}

test('searchPrintings waits out the 30 seconds Scryfall blocks it for after a 429, then asks again', async () => {
    const statuses = [429, 200];
    const asked: number[] = [];
    // From the real time on, which the limiter took when it was made.
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    const start = Date.now();
    mock.method(globalThis, 'fetch', async () => {
        asked.push(Date.now() - start);
        return statuses.shift() === 429
            ? new Response('{"object":"error","code":"rate_limited"}', { status: 429 })
            : Response.json({ data: [printing('a')], has_more: false });
    });

    try {
        let done = false;
        const search = searchPrintings({ name: 'Sol Ring', printing: printing('a') }).finally(() => done = true);
        for (let second = 0; !done && second < 60; second++) {
            await new Promise(resolve => setImmediate(resolve));
            mock.timers.tick(1000);
        }

        assert.deepEqual((await search).map(p => p.id), ['a']);
        assert.equal(asked.length, 2);
        assert.ok(asked[1]! - asked[0]! >= 30_000, `asked again after ${asked[1]! - asked[0]!} ms`);
    } finally {
        mock.timers.reset();
    }
});

test('searchPrintings finds all printings by oracle id, including extras, across pages', async () => {
    const urls = mockPages({
        'page=2': { data: [printing('b')], has_more: false },
        'search': { data: [printing('a')], has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2' }
    });

    const printings = await searchPrintings({ name: 'Sol Ring', printing: printing('a') });

    assert.deepEqual(printings.map(p => p.id), ['a', 'b']);
    assert.match(decodeURIComponent(urls[0]!), /q=oracleid:oracle-1&unique=prints/);
    assert.match(urls[0]!, /include_extras=true/);
    assert.ok(!('oracle_text' in printings[0]!), 'printings are trimmed');
    assert.deepEqual(printings[0]!.prices, { eur: '1.20', usd: '1.50' });
    assert.equal(printings[0]!.released_at, '2024-11-15');
});

test('searchPrintings uses the face oracle id of reversible cards', async () => {
    const urls = mockPages({ 'search': { data: [], has_more: false } });
    const { oracle_id: _, ...reversible } = printing('a');

    await searchPrintings({ name: 'Sol Ring', printing: { ...reversible, card_faces: [{ name: 'Sol Ring', oracle_id: 'face-oracle', type_line: 'Artifact' }] } });

    assert.match(decodeURIComponent(urls[0]!), /oracleid:face-oracle/);
});

test('searchPrintings falls back to the exact name and returns nothing when Scryfall finds nothing', async () => {
    const urls = mockPages({});

    assert.deepEqual(await searchPrintings({ name: 'A-The One Ring' }), []);
    assert.match(decodeURIComponent(urls[0]!), /q=!"A-The One Ring"/);
});

test('searchTokens finds paper tokens by name, one per artwork, and nothing when no token has the name', async () => {
    const urls = mockPages({ 'clue': { data: [printing('t1', { name: 'Clue', type_line: 'Token Artifact — Clue', layout: 'token' })], has_more: false } });

    const tokens = await searchTokens('clue');
    assert.deepEqual(tokens.map(token => [token.id, token.name]), [['t1', 'Clue']]);
    const url = new URL(urls[0]!);
    assert.equal(url.searchParams.get('q'), 't:token -is:digital clue');
    assert.equal(url.searchParams.get('unique'), 'art');

    assert.deepEqual(await searchTokens('zzqx'), []);
});
