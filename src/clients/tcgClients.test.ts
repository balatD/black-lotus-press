import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setDataRoot } from "../config/paths.js";
import { findYgoCards, searchYgoArtworks } from "./ygoprodeck.js";
import { findTcgdexSet, searchTcgdexCards } from "./tcgdex.js";
import { cacheTcgImage } from "./tcgImages.js";

afterEach(() => {
    mock.restoreAll();
    setDataRoot(process.cwd());
});

const blueEyes = {
    id: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster',
    card_images: [{ id: 89631139, image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' }, { id: 89631141, image_url: 'https://images.ygoprodeck.com/images/cards/89631141.jpg' }]
};

test('findYgoCards looks up all passcodes of a deck in one request and finds nothing on a 400', async () => {
    const urls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        urls.push(url);
        return url.includes('12345678') ? new Response('{"error":"No card matching your query was found"}', { status: 400 }) : Response.json({ data: [blueEyes] });
    });

    assert.deepEqual((await findYgoCards([89631139, 46986414])).map(card => card.name), ['Blue-Eyes White Dragon']);
    assert.deepEqual(await findYgoCards([12345678]), []);
    assert.deepEqual(urls, ['https://db.ygoprodeck.com/api/v7/cardinfo.php?id=89631139,46986414', 'https://db.ygoprodeck.com/api/v7/cardinfo.php?id=12345678']);
});

test('findYgoCards says that YGOPRODeck blocks the computer for an hour after a 429', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));

    await assert.rejects(findYgoCards([89631139]), /for an hour/);
});

test('searchYgoArtworks lists every artwork of a card by its name', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ data: [blueEyes] }));

    assert.deepEqual(await searchYgoArtworks('Blue-Eyes White Dragon'), [
        { tcg: 'yugioh', id: 89631139, image: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' },
        { tcg: 'yugioh', id: 89631141, image: 'https://images.ygoprodeck.com/images/cards/89631141.jpg' }
    ]);
});

test('findTcgdexSet turns a set code of a deck list into the TCGdex set, with the promo codes Pokémon TCG Live uses', async () => {
    const urls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        urls.push(url);
        return Response.json(url.includes('eq:OBF') ? [{ id: 'sv03', name: 'Obsidian Flames' }] : []);
    });

    assert.equal(await findTcgdexSet('OBF'), 'sv03');
    assert.equal(await findTcgdexSet('NOPE'), undefined);
    assert.equal(await findTcgdexSet('PR-SW'), 'swshp');
    assert.deepEqual(urls, ['https://api.tcgdex.net/v2/en/sets?abbreviation.official=eq:OBF', 'https://api.tcgdex.net/v2/en/sets?abbreviation.official=eq:NOPE']);
});

test('cacheTcgImage downloads a card image once into the data folder and refuses other hosts', async () => {
    setDataRoot(await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-images-')));
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const url = 'https://images.ygoprodeck.com/images/cards/89631139.jpg';

    const [first, second] = await Promise.all([cacheTcgImage(url), cacheTcgImage(url)]);
    const third = await cacheTcgImage(url);

    assert.equal(first, second);
    assert.equal(first, third);
    assert.match(first, /cache[/\\]tcg[/\\][0-9a-f]{16}\.jpg$/);
    assert.deepEqual([...await fs.readFile(first)], [0xff, 0xd8, 0xff]);
    assert.equal(fetchMock.mock.callCount(), 1);
    await assert.rejects(cacheTcgImage('https://example.com/card.jpg'), /only come from YGOPRODeck, TCGdex, Lorcast and optcgapi.com/);
});

test('searchTcgdexCards leaves out the cards of Pokémon TCG Pocket, which are no paper cards', async () => {
    mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/series/tcgp')
        ? { id: 'tcgp', sets: [{ id: 'A1' }, { id: 'P-A' }] }
        : [{ id: 'sv03-125', localId: '125', name: 'Charizard ex' }, { id: 'A1-036', localId: '036', name: 'Charizard ex' }, { id: 'P-A-007', localId: '007', name: 'Charizard ex' }]));

    assert.deepEqual((await searchTcgdexCards('en', 'Charizard ex')).map(card => card.id), ['sv03-125']);
});
