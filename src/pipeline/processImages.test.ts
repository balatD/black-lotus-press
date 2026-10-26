import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DefaultOrder, DefaultProfile, type Order, type OrderCard, type ScryfallCard } from "../model.js";
import { cardsDir, customImagePath, setDataRoot } from "../config/paths.js";
import { forgetImages, imageStatus, processImages, settingsFingerprint, usedBaseImages } from "./processImages.js";
import { moveOrder, saveOrder } from "../config/orderConfigManager.js";

const scan = await sharp({ create: { width: 745, height: 1040, channels: 4, background: { r: 90, g: 60, b: 40, alpha: 1 } } }).png().toBuffer();
const mpcImage = await sharp({ create: { width: 816, height: 1110, channels: 3, background: '#3366aa' } }).jpeg().toBuffer();
let fetched: string[] = [];

beforeEach(async () => {
    setDataRoot(await fs.mkdtemp(path.join(os.tmpdir(), 'process-images-')));
    fetched = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        fetched.push(url);
        if (url.includes('/missing.png')) return new Response('not found', { status: 404 });
        if (url.includes('googleusercontent.com')) return new Response(new Uint8Array(mpcImage), { status: 200, headers: { 'content-type': 'image/jpeg' } });
        return new Response(new Uint8Array(scan), { status: 200, headers: { 'content-type': 'image/png' } });
    });
});

afterEach(() => {
    mock.restoreAll();
    setDataRoot(process.cwd());
});

function printing(id: string): ScryfallCard {
    const png = `https://cards.scryfall.io/png/front/a/b/${id}.png`;
    return {
        id, name: `Card ${id}`, set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Creature', layout: 'normal',
        image_uris: { small: png, normal: png, large: png, png, art_crop: png, border_crop: png }
    };
}

function card(id: string, quantity: number, options: Partial<OrderCard> = {}): OrderCard {
    return { id, deck: 'deck', board: 'mainboard', name: id, quantity, isToken: false, excluded: false, printing: printing(id), ...options };
}

function order(cards: OrderCard[], dpi = 150): Order {
    const profile = { ...DefaultProfile, postProcessing: { ...DefaultProfile.postProcessing, dpi } };
    return { ...DefaultOrder, name: 'test', cardBack: 'drive1', profile, cards };
}

async function processedFiles(target: Order) {
    return (await fs.readdir(cardsDir(target))).filter(file => file.endsWith('.jpg') && !file.startsWith('base-')).sort();
}

test('processImages names files after the printing and adds blanks and the card back', async () => {
    const target = order([card('a', 2), card('b', 1)]);
    const ready: string[] = [];

    await processImages(target, 'cmyk', event => event.type === 'face-ready' && ready.push(event.file));

    const expected = ['blank.jpg', 'cardback-drive1-b110-c100.jpg', 'scryfall-a-front-b110-c100.jpg', 'scryfall-b-front-b110-c100.jpg'];
    const bases = ['base-cardback-drive1.jpg', 'base-scryfall-a-front.jpg', 'base-scryfall-b-front.jpg'];
    assert.deepEqual(await processedFiles(target), expected);
    assert.deepEqual(ready.sort(), [...bases, ...expected].sort());
    assert.equal((await sharp(path.join(cardsDir(target), 'scryfall-a-front-b110-c100.jpg')).metadata()).space, 'cmyk');
});

test('processImages makes sRGB print images for notmpc', async () => {
    const target = { ...order([card('a', 1)]), shop: 'notmpc' as const };

    await processImages(target, 'cmyk');

    assert.equal((await sharp(path.join(cardsDir(target), 'scryfall-a-front-b110-c100.jpg')).metadata()).space, 'srgb');
});

test('processImages makes sRGB print images of at least 816 × 1110 pixels for printerstudio', async () => {
    const target = { ...order([card('a', 1)], 300), shop: 'printerstudio' as const };

    await processImages(target, 'cmyk');

    for (const file of ['scryfall-a-front-b110-c100.jpg', 'cardback-drive1-b110-c100.jpg']) {
        const image = await sharp(path.join(cardsDir(target), file)).metadata();
        assert.deepEqual([image.width, image.height, image.space], [816, 1110, 'srgb'], file);
    }
});

test('after a move to printerstudio, processImages makes the print images anew from the base images without downloading', async () => {
    const target = order([card('a', 1)], 300);
    await saveOrder(target);
    await processImages(target, 'cmyk');
    const downloads = fetched.length;

    await moveOrder(target, 'printerstudio');
    await processImages({ ...target, shop: 'printerstudio' }, 'cmyk');

    assert.equal(fetched.length, downloads);
    const image = await sharp(path.join(cardsDir(target), 'scryfall-a-front-b110-c100.jpg')).metadata();
    assert.deepEqual([image.width, image.space], [816, 'srgb']);
});

test('processImages downloads MPC Autofill images at the height of the print and keeps their bleed', async () => {
    const target = order([card('a', 1, { mpcfill: { front: 'drive-a' } })], 300);

    await processImages(target, 'cmyk');

    assert.ok(fetched.includes('https://lh3.googleusercontent.com/d/drive-a=h1110-l100'));
    const base = await sharp(path.join(cardsDir(target), 'base-mpcfill-drive-a.jpg')).metadata();
    assert.deepEqual([base.width, base.height], [816, 1110]);
});

test('processImages never upscales MPC Autofill images and keeps the bleed they have', async () => {
    const target = order([card('a', 1, { mpcfill: { front: 'drive-a' } })], 600);
    target.profile = { ...target.profile, upscaling: { ...target.profile.upscaling, enabled: true, binaryFile: 'no-upscayl-here' } };

    await processImages(target, 'cmyk');

    const base = await sharp(path.join(cardsDir(target), 'base-mpcfill-drive-a.jpg')).metadata();
    assert.deepEqual([base.width, base.height], [816, 1110]);
});

test('processImages gives MPC Autofill images without bleed a mirrored one', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(await sharp({ create: { width: 750, height: 1048, channels: 3, background: '#3366aa' } }).jpeg().toBuffer()), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const target = order([card('a', 1, { mpcfill: { front: 'drive-a' } })], 300);

    await processImages(target, 'cmyk');

    const base = await sharp(path.join(cardsDir(target), 'base-mpcfill-drive-a.jpg')).metadata();
    assert.deepEqual([base.width, base.height], [822, 1120]);
});

test('processImages skips images that already exist', async () => {
    const target = order([card('a', 1)]);
    await processImages(target, 'cmyk');
    fetched = [];

    await processImages(target, 'cmyk');

    assert.deepEqual(fetched, []);
});

test('processImages rebuilds the cache when the settings change', async () => {
    await processImages(order([card('a', 1)]), 'cmyk');
    fetched = [];

    const changed = order([card('a', 1)], 160);
    await processImages(changed, 'cmyk');

    assert.ok(fetched.some(url => url.endsWith('/a.png')));
    assert.equal((await sharp(path.join(cardsDir(changed), 'scryfall-a-front-b110-c100.jpg')).metadata()).width, 435);
});

test('processImages leaves out excluded cards and dropped tokens', async () => {
    const target = order([card('island', 55), card('excluded', 1, { excluded: true }), card('treasure', 1, { isToken: true })]);

    await processImages(target, 'cmyk');

    assert.deepEqual(fetched.filter(url => url.includes('scryfall')), ['https://cards.scryfall.io/png/front/a/b/island.png']);
});

test('processImages keeps going when one image fails and names the card', async () => {
    const target = order([card('a', 1), card('missing', 1)]);
    const failed: string[] = [];

    await assert.rejects(processImages(target, 'cmyk', event => event.type === 'face-failed' && failed.push(event.file)), /Card missing \(TST 1, front\)/);

    assert.deepEqual(failed, ['scryfall-missing-front-b110-c100.jpg']);
    assert.ok((await processedFiles(target)).includes('scryfall-a-front-b110-c100.jpg'));
});

test('processImages stops when cancelled and writes no images', async () => {
    const target = order([card('a', 1), card('b', 1)]);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(processImages(target, 'cmyk', undefined, controller.signal), { name: 'AbortError' });

    assert.deepEqual(await processedFiles(target), []);
});

test('processImages uses the own image instead of the Scryfall scan', async () => {
    await fs.mkdir(path.dirname(customImagePath('own.png')), { recursive: true });
    await sharp({ create: { width: 630, height: 880, channels: 3, background: '#3366aa' } }).png().toFile(customImagePath('own.png'));
    const target = order([card('a', 1, { customImage: { front: 'own.png' } })]);

    await processImages(target, 'cmyk');

    assert.ok((await processedFiles(target)).includes('custom-own-b110-c100.jpg'));
    assert.deepEqual(fetched.filter(url => url.includes('scryfall')), []);
});

test('imageStatus lists the processed images and their sizes for the current settings only', async () => {
    const target = order([card('a', 1)]);
    assert.deepEqual(await imageStatus(target), { version: '', files: {} });

    await processImages(target, 'cmyk');
    const status = await imageStatus(target);

    assert.deepEqual(Object.keys(status.files).sort(),
        ['base-cardback-drive1.jpg', 'base-scryfall-a-front.jpg', 'blank.jpg', 'cardback-drive1-b110-c100.jpg', 'scryfall-a-front-b110-c100.jpg']);
    assert.ok(Object.values(status.files).every(bytes => bytes > 0));
    assert.match(status.version, /^[0-9a-f]{8}$/);
    assert.deepEqual(await imageStatus(order([card('a', 1)], 160)), { version: '', files: {} });
});

test('usedBaseImages names the base images the packs use with the cache file, and none made with other settings', async () => {
    await processImages(order([card('a', 1), card('b', 1)]), 'cmyk');

    assert.deepEqual((await usedBaseImages(order([card('a', 1)]))).sort(), ['base-cardback-drive1.jpg', 'base-scryfall-a-front.jpg', 'cache.json']);
    assert.deepEqual(await usedBaseImages(order([card('a', 1)], 160)), []);
});

test('processImages renders new adjustments from the stored base images and removes the old print images', async () => {
    const target = order([card('a', 1)]);
    await processImages(target, 'cmyk');
    fetched = [];

    const brighter = { ...target, adjustments: { brightness: 1.25, contrast: 1.1 } };
    await processImages(brighter, 'cmyk');

    assert.deepEqual(fetched, []);
    assert.deepEqual(await processedFiles(brighter), ['blank.jpg', 'cardback-drive1-b125-c110.jpg', 'scryfall-a-front-b125-c110.jpg']);
});

test('processImages shares one base image between cards with different adjustments', async () => {
    const plain = card('a', 1);
    const adjusted = { ...card('a', 1), id: 'a2', adjustments: { brightness: 0.9, contrast: 1 } };

    await processImages(order([plain, adjusted]), 'cmyk');

    assert.equal(fetched.filter(url => url.includes('scryfall')).length, 1);
    assert.ok((await processedFiles(order([]))).includes('scryfall-a-front-b99-c100.jpg'));
    assert.ok((await processedFiles(order([]))).includes('scryfall-a-front-b110-c100.jpg'));
});

test('settingsFingerprint only depends on the own copyright text when it is printed', () => {
    const profile = (copyrightBehavior: 'blur' | 'custom', copyrightText?: string) =>
        ({ ...DefaultProfile, postProcessing: { ...DefaultProfile.postProcessing, copyrightBehavior, ...(copyrightText === undefined ? {} : { copyrightText }) } });

    assert.equal(settingsFingerprint(profile('blur', 'a')), settingsFingerprint(profile('blur')), 'existing caches stay valid');
    assert.notEqual(settingsFingerprint(profile('custom', 'a')), settingsFingerprint(profile('custom', 'b')));
});

test('forgetImages drops one face with its base and all its print images, so the next run makes only that face again', async () => {
    const target = order([card('a', 1), card('b', 1, { adjustments: { brightness: 1.3, contrast: 1 } }), card('c', 1)]);
    await processImages(target, 'cmyk');
    const withB = order([...target.cards, { ...card('b', 1), id: 'b2' }]);
    await processImages(withB, 'cmyk');
    const before = await fs.readdir(cardsDir(target));
    fetched = [];

    await forgetImages(withB, ['scryfall-b-front-b143-c100.jpg']);

    const after = await fs.readdir(cardsDir(target));
    assert.deepEqual(before.filter(file => !after.includes(file)).sort(), ['base-scryfall-b-front.jpg', 'scryfall-b-front-b110-c100.jpg', 'scryfall-b-front-b143-c100.jpg']);
    await processImages(withB, 'cmyk');
    assert.deepEqual(fetched.map(url => url.replace(/^.*\//, '')), ['b.png']);
});
