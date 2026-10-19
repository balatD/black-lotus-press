import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { OrderCard, ScryfallCard } from "../model.js";
import { imageHashes, type KnownPrinting, nameHint, pickSharpestMpcfillImages, recognise, recogniseMpcfillImages } from "./recognise.js";

afterEach(() => mock.restoreAll());

function printing(id: string, set = 'tst', collector_number = '1'): ScryfallCard {
    return { id, name: 'Card', set, collector_number, lang: 'en', full_art: false, frame: '2015', type_line: 'Artifact', layout: 'normal' };
}

// A card of 745 × 1040 pixels: a black frame with a text box around art made of soft colour patches, different per seed.
async function scan(seed: number) {
    let state = seed;
    const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    const patches = Buffer.from(Array.from({ length: 6 * 4 * 3 }, () => Math.floor(random() * 256)));
    const art = await sharp(patches, { raw: { width: 6, height: 4, channels: 3 } }).resize(650, 470, { kernel: 'cubic' }).png().toBuffer();
    const box = await sharp({ create: { width: 650, height: 380, channels: 3, background: '#e8e2d0' } }).png().toBuffer();
    return await sharp({ create: { width: 745, height: 1040, channels: 3, background: '#111111' } })
        .composite([{ input: art, left: 48, top: 110 }, { input: box, left: 48, top: 600 }])
        .png().toBuffer();
}

// What MPC Autofill serves: the card with mirrored bleed, as a small preview of 293 × 400 pixels, a little brighter.
async function mpcfillPreview(card: Buffer) {
    const bled = await sharp(card).extend({ top: 29, bottom: 29, left: 33, right: 33, extendWith: 'mirror' }).png().toBuffer();
    return await sharp(bled).resize(293, 400, { fit: 'fill' }).modulate({ brightness: 1.05 }).jpeg({ quality: 80 }).toBuffer();
}

async function known(id: string, seed: number, illustration = `art-${seed}`): Promise<KnownPrinting> {
    return { printing: printing(id), illustration, hashes: await imageHashes(await sharp(await scan(seed)).resize(146, 204).jpeg().toBuffer(), false) };
}

const image = async (seed: number, name = 'Card', tags: string[] = []) => ({ hashes: await imageHashes(await mpcfillPreview(await scan(seed)), true), name, tags });

test('recognise finds the printing a faithful MPC Autofill image shows, and not one with other art', async () => {
    const printings = [await known('one', 1), await known('two', 2)];

    assert.deepEqual(recognise(await image(1), printings, new Set()), { printings: ['one'], unofficial: false });
    assert.deepEqual(recognise(await image(2), printings, new Set()), { printings: ['two'], unofficial: false });
    assert.deepEqual(recognise(await image(3), printings, new Set()), { printings: [], unofficial: false });
});

test('recognise counts every printing of the same art and puts the one the name gives first', async () => {
    const printings = [await known('c21', 1), { ...await known('m3c', 1), printing: printing('m3c', 'm3c', '305') }];

    assert.deepEqual(recognise(await image(1), printings, new Set()).printings.sort(), ['c21', 'm3c']);
    assert.deepEqual(recognise(await image(1, 'Sol Ring [M3C] {305}'), printings, new Set()).printings, ['m3c', 'c21']);
});

test('recognise leaves out images tagged as unofficial without comparing them', async () => {
    assert.deepEqual(recognise(await image(1, 'Card', ['Frame', 'Custom Art']), [await known('one', 1)], new Set(['Custom Art'])), { printings: [], unofficial: true });
});

test('nameHint reads set code and collector number the ways uploaders write them', () => {
    const printings = [printing('2x2', '2x2', '117'), printing('m10', 'm10', '146'), printing('sld', 'sld', '1494'), printing('lea', 'lea', '161')];
    const hint = (name: string) => nameHint(name, printings)?.id;

    assert.equal(hint('Lightning Bolt (Normal, Christopher Moeller) [2X2] {117}'), '2x2');
    assert.equal(hint('Lightning Bolt (M10 146)'), 'm10');
    assert.equal(hint('Lightning Bolt (SLD1494)'), 'sld');
    assert.equal(hint('Lightning Bolt {1494}'), 'sld');
    assert.equal(hint('Lightning Bolt (LEA 161) (Full Art)'), 'lea');
    assert.equal(hint('Lightning Bolt (Christopher Moeller-146)'), undefined);
    assert.equal(hint('Lightning Bolt [M10]'), undefined);
});

test('recogniseMpcfillImages counts images whose preview cannot be loaded as not recognised', async () => {
    const preview = await mpcfillPreview(await scan(1));
    const smallScan = await sharp(await scan(1)).resize(146, 204).jpeg().toBuffer();
    mock.method(globalThis, 'fetch', async (url: string) => {
        const reply = (body: Uint8Array | string, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
        if (url.endsWith('/2/tags/')) return reply(JSON.stringify({ tags: [] }), 'application/json');
        if (url.includes('cards.scryfall.io')) return reply(new Uint8Array(smallScan), 'image/jpeg');
        if (url.includes('/good-')) return reply(new Uint8Array(preview), 'image/jpeg');
        return reply('rate limited', 'text/plain', 429);
    });
    const small = 'https://cards.scryfall.io/small/front/a/b/one.jpg';
    const withImages = { ...printing('one'), image_uris: { small, normal: small, large: small, png: small, art_crop: small, border_crop: small } };
    const image = (identifier: string) => ({ identifier, name: 'Card', sourceName: 'Source', dpi: 1200, tags: [] });

    const results = await recogniseMpcfillImages('front', [withImages], [image('good'), image('broken')]);

    assert.deepEqual(results, { good: { printings: ['one'], unofficial: false }, broken: { printings: [], unofficial: false } });
});

test('pickSharpestMpcfillImages takes the image of the highest resolution that shows the printing, and leaves cards with images alone', async () => {
    const seeds: Record<string, number> = { sharp: 1, blurry: 1, other: 2 };
    const previews = Object.fromEntries(await Promise.all(Object.entries(seeds).map(async ([id, seed]) => [id, await mpcfillPreview(await scan(seed))] as const)));
    const smallScan = await sharp(await scan(1)).resize(146, 204).jpeg().toBuffer();
    const small = 'https://cards.scryfall.io/small/front/a/b/p1.jpg';
    const found = { ...printing('p1'), image_uris: { small, normal: small, large: small, png: small, art_crop: small, border_crop: small } };
    const searches: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        const image = (body: Buffer) => new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'image/jpeg' } });
        if (url.startsWith('https://api.scryfall.com/cards/search')) {
            searches.push(url);
            return json({ data: [found], has_more: false });
        }
        if (url === small) return image(smallScan);
        if (url.endsWith('/2/sources/')) return json({ results: { '1': { pk: 1 } } });
        if (url.endsWith('/2/tags/')) return json({ tags: [] });
        if (url.endsWith('/2/editorSearch/')) return json({ results: { Card: { CARD: ['blurry', 'other', 'sharp'] } } });
        if (url.endsWith('/2/cards/')) {
            const card = (identifier: string, dpi: number) => ({ identifier, name: 'Card', sourceName: 'Source', dpi, tags: [] });
            return json({ results: { blurry: card('blurry', 600), other: card('other', 1200), sharp: card('sharp', 800) } });
        }
        const id = Object.keys(previews).find(key => url.includes(`/${key}-small`));
        return id ? image(previews[id]!) : new Response('not found', { status: 404 });
    });
    const card = (id: string, extra: Partial<OrderCard> = {}): OrderCard => ({ id, deck: 'deck', board: 'mainboard', name: 'Card', quantity: 1, isToken: false, excluded: false, printing: found, ...extra });

    const picks = await pickSharpestMpcfillImages([
        card('plain'),
        card('same printing'),
        card('switched off', { excluded: true }),
        card('own image', { customImage: { front: 'own.png' } }),
        card('picked by hand', { mpcfill: { front: 'blurry' } })
    ]);

    assert.deepEqual(picks, { 'plain': { front: 'sharp' }, 'same printing': { front: 'sharp' } });
    assert.equal(searches.length, 1, 'cards of the same printing are looked up once');
});
