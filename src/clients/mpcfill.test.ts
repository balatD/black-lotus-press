import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { mpcfillFileNames, searchCardbacks, searchMpcfill, unofficialTags } from "./mpcfill.js";

const card = (identifier: string) => ({ identifier, name: `Lightning Bolt ${identifier}`, extension: 'png', sourceName: 'Source', dpi: 1200, tags: [], language: 'EN', size: 1 });
let searches: { queries: unknown, searchSettings: { sourceSettings: { sources: unknown }, filterSettings: { languages: unknown } } }[] = [];

beforeEach(() => {
    searches = [];
    mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/2/sources/')) return json({ results: { '1': { pk: 1, name: 'One' }, '2': { pk: 2, name: 'Two' } } });
        if (url.endsWith('/2/editorSearch/')) {
            searches.push(JSON.parse(String(init?.body)));
            return json({ results: { 'Lightning Bolt': { CARD: ['b', 'a', 'gone'] } } });
        }
        if (url.endsWith('/2/cardbacks/')) {
            searches.push(JSON.parse(String(init?.body)));
            return json({ cardbacks: ['b', 'a', 'gone'] });
        }
        if (url.endsWith('/2/cards/')) return json({ results: { a: card('a'), b: card('b') } });
        if (url.endsWith('/2/tags/')) {
            const tag = (name: string, children: unknown[] = []) => ({ name, aliases: [], children });
            return json({ tags: [tag('Art', [tag('Custom Art', [tag('AI Art', [tag('AI Remaster')])]), tag('Upscaled Scan')]), tag('Frame', [tag('Custom-Made Frame', [tag('Minimalist')]), tag('M15')]), tag('Misc', [tag('Alternate Name', [tag('Nickname')])])] });
        }
        return new Response('not found', { status: 404 });
    });
});

afterEach(() => mock.restoreAll());

test('searchMpcfill looks in every source for the language and keeps the order of the results', async () => {
    const cards = await searchMpcfill('Lightning Bolt', 'CARD', 'zhs');

    assert.deepEqual(cards.map(found => found.identifier), ['b', 'a']);
    assert.deepEqual(searches[0]?.queries, [{ query: 'Lightning Bolt', cardType: 'CARD' }]);
    assert.deepEqual(searches[0]?.searchSettings.sourceSettings.sources, [[1, true], [2, true]]);
    assert.deepEqual(searches[0]?.searchSettings.filterSettings.languages, ['ZH']);
});

test('searchCardbacks lists the card backs of every source in the order of MPC Autofill', async () => {
    const cardbacks = await searchCardbacks();

    assert.deepEqual(cardbacks.map(found => found.identifier), ['b', 'a']);
    assert.deepEqual(searches.at(-1)?.searchSettings.sourceSettings.sources, [[1, true], [2, true]]);
    assert.deepEqual(searches.at(-1)?.searchSettings.filterSettings.languages, []);
});

test('mpcfillFileNames are the names and extensions of the images MPC Autofill still has', async () => {
    assert.deepEqual(await mpcfillFileNames(['a', 'gone']), new Map([['a', 'Lightning Bolt a.png']]));
});

test('unofficialTags are the tags of custom art, altered art, custom frames and other names, with their children but AI Remaster', async () => {
    assert.deepEqual([...await unofficialTags()].sort(), ['AI Art', 'Alternate Name', 'Custom Art', 'Custom-Made Frame', 'Minimalist', 'Nickname']);
});
