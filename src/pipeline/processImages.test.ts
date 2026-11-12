import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_HOME_PRINT, DefaultOrder, DefaultProfile, type HomePrint, NO_ADJUSTMENTS, type Order, type OrderCard, type ScryfallCard } from "../model.js";
import { cardsDir, customImagePath, setDataRoot } from "../config/paths.js";
import { cardProfile, faceJobs, forgetImages, imageStatus, processImages, settingsFingerprint, usedBaseImages, writePrintPng } from "./processImages.js";
import { moveOrder, saveOrder } from "../config/orderConfigManager.js";
import { BLANK_FILE } from "./packs.js";
import { printSizeInPixels } from "../output/printImage.js";

const scan = await sharp({ create: { width: 745, height: 1040, channels: 4, background: { r: 90, g: 60, b: 40, alpha: 1 } } }).png().toBuffer();
const mpcImage = await sharp({ create: { width: 816, height: 1110, channels: 3, background: '#3366aa' } }).jpeg().toBuffer();
const ygoImage = await sharp({ create: { width: 813, height: 1185, channels: 3, background: '#7a5230' } }).jpeg().toBuffer();
// Like TCGdex scans: transparent rounded corners and a little wider than the card.
const pokemonImage = await sharp({ create: { width: 600, height: 825, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="600" height="825"><rect width="600" height="825" rx="24" fill="#d4b13a"/></svg>') }]).png().toBuffer();
let fetched: string[] = [];

beforeEach(async () => {
    setDataRoot(await fs.mkdtemp(path.join(os.tmpdir(), 'process-images-')));
    fetched = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
        fetched.push(url);
        if (url.includes('/missing.png')) return new Response('not found', { status: 404 });
        if (url.includes('googleusercontent.com') || url.includes('drive.google.com')) return new Response(new Uint8Array(mpcImage), { status: 200, headers: { 'content-type': 'image/jpeg' } });
        if (url.includes('images.ygoprodeck.com')) return new Response(new Uint8Array(ygoImage), { status: 200, headers: { 'content-type': 'image/jpeg' } });
        if (url.includes('assets.tcgdex.net')) return new Response(new Uint8Array(pokemonImage), { status: 200, headers: { 'content-type': 'image/png' } });
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

    await processImages(target, event => event.type === 'face-ready' && ready.push(event.file));

    const expected = ['blank.jpg', 'cardback-drive1-b110-c100.jpg', 'scryfall-a-front-b110-c100.jpg', 'scryfall-b-front-b110-c100.jpg'];
    const bases = ['base-cardback-drive1.jpg', 'base-scryfall-a-front.jpg', 'base-scryfall-b-front.jpg'];
    assert.deepEqual(await processedFiles(target), expected);
    assert.deepEqual(ready.sort(), [...bases, ...expected].sort());
    assert.equal((await sharp(path.join(cardsDir(target), 'scryfall-a-front-b110-c100.jpg')).metadata()).space, 'srgb');
});

test('processImages makes sRGB print images of at least 816 × 1110 pixels for printerstudio', async () => {
    const target = { ...order([card('a', 1)], 300), shop: 'printerstudio' as const };

    await processImages(target);

    for (const file of ['scryfall-a-front-b110-c100.jpg', 'cardback-drive1-b110-c100.jpg']) {
        const image = await sharp(path.join(cardsDir(target), file)).metadata();
        assert.deepEqual([image.width, image.height, image.space], [816, 1110, 'srgb'], file);
    }
});

test('after a move to printerstudio, processImages makes the print images anew from the base images without downloading', async () => {
    const target = order([card('a', 1)], 300);
    await saveOrder(target);
    await processImages(target);
    const downloads = fetched.length;

    await moveOrder(target, 'printerstudio');
    await processImages({ ...target, shop: 'printerstudio' });

    assert.equal(fetched.length, downloads);
    const image = await sharp(path.join(cardsDir(target), 'scryfall-a-front-b110-c100.jpg')).metadata();
    assert.deepEqual([image.width, image.space], [816, 'srgb']);
});

test('processImages keeps MPC Autofill images in their own resolution above that of the profile, with their bleed', async () => {
    const target = order([card('a', 1, { mpcfill: { front: 'drive-a' } })], 150);

    await processImages(target);

    assert.ok(fetched.includes('https://drive.google.com/uc?export=download&id=drive-a'));
    const base = await sharp(path.join(cardsDir(target), 'base-mpcfill-full-drive-a.jpg')).metadata();
    assert.deepEqual([base.width, base.height], [816, 1110]);
});

test('processImages upscales MPC Autofill images and card backs below the resolution of the profile', async () => {
    const target = order([card('a', 1, { mpcfill: { front: 'drive-a' } })], 600);
    target.profile = { ...target.profile, upscaling: { ...target.profile.upscaling, enabled: true, binaryFile: 'no-upscayl-here' } };
    const failed: string[] = [];

    await assert.rejects(processImages(target, event => event.type === 'face-failed' && failed.push(event.file)), /Upscayl is not installed/);

    assert.deepEqual(failed.sort(), ['cardback-drive1-b110-c100.jpg', 'mpcfill-full-drive-a-b110-c100.jpg']);
});

test('processImages makes the print images of a home order in their own resolution as the finest JPEGs, under names of their own', async () => {
    const target = { ...order([card('m', 1, { mpcfill: { front: 'drive-m' } })]), shop: 'home' as const };

    await processImages(target);

    // The MPC Autofill image has about 300 dpi, twice the profile's 150 dpi, and keeps them.
    const image = await sharp(path.join(cardsDir(target), 'mpcfill-full-drive-m-b110-c100-finest.jpg')).metadata();
    assert.deepEqual([image.width, image.height, image.chromaSubsampling], [815, 1110, '4:4:4']);
});

test('processImages makes Yu-Gi-Oh cards at 59 × 86 mm with a mirrored 3 mm bleed, prints only the fronts at home and keeps their cache apart', async () => {
    const target: Order = { ...order([card('kuriboh', 2, { tcgCard: { tcg: 'yugioh', id: 40640057, image: 'https://images.ygoprodeck.com/images/cards/40640057.jpg' } })], 300), shop: 'home', tcg: 'yugioh' };

    await processImages(target);

    const base = await sharp(path.join(cardsDir(target), 'base-ygo-40640057.jpg')).metadata();
    assert.deepEqual([base.width, base.height], [895, 1267]);
    // 895 pixels on the 65 mm page are about 350 dpi, more than the profile's 300.
    const print = await sharp(path.join(cardsDir(target), 'ygo-40640057-b110-c100-finest.jpg')).metadata();
    assert.deepEqual([print.width, print.height], [895, 1267]);
    assert.deepEqual(await processedFiles(target), ['ygo-40640057-b110-c100-finest.jpg'], 'neither a blank card nor the card back');
    assert.notEqual(settingsFingerprint(cardProfile(target)), settingsFingerprint(target.profile));
});

test('processImages fills the transparent corners of Pokémon scans and brings them to the shape of the card', async () => {
    const target: Order = { ...order([card('charizard', 1, { tcgCard: { tcg: 'pokemon', id: 'sv03-125', lang: 'en', image: 'https://assets.tcgdex.net/en/sv/sv03/125/high.png' } })], 150), shop: 'home', tcg: 'pokemon' };

    await processImages(target);

    const { data, info } = await sharp(path.join(cardsDir(target), 'base-ptcg-en-sv03-125.jpg')).raw().toBuffer({ resolveWithObject: true });
    // 600 × 838 for 63 × 88 mm, plus 3 mm of bleed on every side.
    assert.deepEqual([info.width, info.height], [658, 896]);
    const bleed = 29;
    const corner = (bleed * info.width + bleed) * info.channels;
    assert.ok(data[corner]! < 240 || data[corner + 2]! < 240, `the corner of the card is not white: ${[...data.subarray(corner, corner + 3)]}`);
});

test('processImages gives MPC Autofill images without bleed a mirrored one', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(await sharp({ create: { width: 750, height: 1048, channels: 3, background: '#3366aa' } }).jpeg().toBuffer()), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const target = order([card('a', 1, { mpcfill: { front: 'drive-a' } })], 300);

    await processImages(target);

    const base = await sharp(path.join(cardsDir(target), 'base-mpcfill-full-drive-a.jpg')).metadata();
    assert.deepEqual([base.width, base.height], [822, 1120]);
});

test('processImages skips images that already exist', async () => {
    const target = order([card('a', 1)]);
    await processImages(target);
    fetched = [];

    await processImages(target);

    assert.deepEqual(fetched, []);
});

test('processImages rebuilds the cache when the settings change', async () => {
    await processImages(order([card('a', 1)]));
    fetched = [];

    const changed = order([card('a', 1)], 160);
    await processImages(changed);

    assert.ok(fetched.some(url => url.endsWith('/a.png')));
    assert.equal((await sharp(path.join(cardsDir(changed), 'scryfall-a-front-b110-c100.jpg')).metadata()).width, 435);
});

test('processImages leaves out excluded cards and dropped tokens', async () => {
    const target = order([card('island', 55), card('excluded', 1, { excluded: true }), card('treasure', 1, { isToken: true })]);

    await processImages(target);

    assert.deepEqual(fetched.filter(url => url.includes('scryfall')), ['https://cards.scryfall.io/png/front/a/b/island.png']);
});

test('processImages keeps going when one image fails and names the card', async () => {
    const target = order([card('a', 1), card('missing', 1)]);
    const failed: string[] = [];

    await assert.rejects(processImages(target, event => event.type === 'face-failed' && failed.push(event.file)), /Card missing \(TST 1, front\)/);

    assert.deepEqual(failed, ['scryfall-missing-front-b110-c100.jpg']);
    assert.ok((await processedFiles(target)).includes('scryfall-a-front-b110-c100.jpg'));
});

test('processImages stops when cancelled and writes no images', async () => {
    const target = order([card('a', 1), card('b', 1)]);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(processImages(target, undefined, controller.signal), { name: 'AbortError' });

    assert.deepEqual(await processedFiles(target), []);
});

test('processImages uses the own image instead of the Scryfall scan', async () => {
    await fs.mkdir(path.dirname(customImagePath('own.png')), { recursive: true });
    await sharp({ create: { width: 630, height: 880, channels: 3, background: '#3366aa' } }).png().toFile(customImagePath('own.png'));
    const target = order([card('a', 1, { customImage: { front: 'own.png' } })]);

    await processImages(target);

    assert.ok((await processedFiles(target)).includes('custom-own-b110-c100.jpg'));
    assert.deepEqual(fetched.filter(url => url.includes('scryfall')), []);
});

test('imageStatus lists the processed images and their sizes for the current settings only', async () => {
    const target = order([card('a', 1)]);
    assert.deepEqual(await imageStatus(target), { version: '', files: {} });

    await processImages(target);
    const status = await imageStatus(target);

    assert.deepEqual(Object.keys(status.files).sort(),
        ['base-cardback-drive1.jpg', 'base-scryfall-a-front.jpg', 'blank.jpg', 'cardback-drive1-b110-c100.jpg', 'scryfall-a-front-b110-c100.jpg']);
    assert.ok(Object.values(status.files).every(bytes => bytes > 0));
    assert.match(status.version, /^[0-9a-f]{8}$/);
    assert.deepEqual(await imageStatus(order([card('a', 1)], 160)), { version: '', files: {} });
});

test('faceJobs makes the backs at home only when both sides print', () => {
    const home = (sides: HomePrint['sides']) => ({ ...order([card('a', 1)]), shop: 'home' as const, adjustments: NO_ADJUSTMENTS, homePrint: { ...DEFAULT_HOME_PRINT, sides } });

    assert.deepEqual([...faceJobs(home('fronts')).keys()], ['scryfall-a-front-b100-c100-finest.jpg']);
    assert.deepEqual([...faceJobs(home('both')).keys()], ['scryfall-a-front-b100-c100-finest.jpg', 'cardback-drive1-b100-c100-finest.jpg']);
});

test('writePrintPng makes the PNG of a face from its base image in the resolution of the base, and a white one for a blank card', async () => {
    const target = order([card('a', 1), card('m', 1, { mpcfill: { front: 'drive-m' } })]);
    await processImages(target);
    const faces = faceJobs(target);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-png-'));

    await writePrintPng(target, faces.get('scryfall-a-front-b110-c100.jpg')!, path.join(dir, 'front.png'));
    await writePrintPng(target, faces.get('mpcfill-full-drive-m-b110-c100.jpg')!, path.join(dir, 'mpcfill.png'));
    await writePrintPng(target, faces.get(BLANK_FILE)!, path.join(dir, 'blank.png'));

    const metadata = async (file: string) => {
        const image = await sharp(path.join(dir, file)).metadata();
        return [image.format, image.width, image.height, image.space, image.channels];
    };
    const minimum = printSizeInPixels(target.shop, 150);
    // The MPC Autofill image has 816 × 1110 pixels, about 300 dpi, twice the profile's 150 dpi.
    assert.deepEqual(await metadata('mpcfill.png'), ['png', 815, 1110, 'srgb', 3]);
    assert.deepEqual(await metadata('blank.png'), ['png', minimum.width, minimum.height, 'srgb', 3]);
    const front = await sharp(path.join(dir, 'front.png')).metadata();
    assert.ok(front.width > minimum.width, `the scan has more than 150 dpi, got ${front.width} pixels`);
    const means = async (file: string) => (await sharp(file).stats()).channels.map(channel => channel.mean);
    const [png, jpeg] = [await means(path.join(dir, 'front.png')), await means(path.join(cardsDir(target), 'scryfall-a-front-b110-c100.jpg'))];
    png.forEach((mean, index) => assert.ok(Math.abs(mean - jpeg[index]!) < 2, `channel ${index}: PNG ${mean}, JPEG ${jpeg[index]}`));
    assert.ok((await sharp(path.join(dir, 'blank.png')).stats()).channels.every(channel => channel.min >= 254));
});

test('writePrintPng makes a base image below the resolution of the profile as large as the profile asks', async () => {
    const target = order([card('m', 1, { mpcfill: { front: 'drive-m' } })], 600);
    await processImages(target);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-png-'));

    await writePrintPng(target, faceJobs(target).get('mpcfill-full-drive-m-b110-c100.jpg')!, path.join(dir, 'mpcfill.png'));

    const image = await sharp(path.join(dir, 'mpcfill.png')).metadata();
    assert.deepEqual([image.width, image.height], [1630, 2220]);
});

test('usedBaseImages names the base images the packs use with the cache file, and none made with other settings', async () => {
    await processImages(order([card('a', 1), card('b', 1)]));

    assert.deepEqual((await usedBaseImages(order([card('a', 1)]))).sort(), ['base-cardback-drive1.jpg', 'base-scryfall-a-front.jpg', 'cache.json']);
    assert.deepEqual(await usedBaseImages(order([card('a', 1)], 160)), []);
});

test('processImages renders new adjustments from the stored base images and removes the old print images', async () => {
    const target = order([card('a', 1)]);
    await processImages(target);
    fetched = [];

    const brighter = { ...target, adjustments: { brightness: 1.25, contrast: 1.1 } };
    await processImages(brighter);

    assert.deepEqual(fetched, []);
    assert.deepEqual(await processedFiles(brighter), ['blank.jpg', 'cardback-drive1-b125-c110.jpg', 'scryfall-a-front-b125-c110.jpg']);
});

test('processImages shares one base image between cards with different adjustments', async () => {
    const plain = card('a', 1);
    const adjusted = { ...card('a', 1), id: 'a2', adjustments: { brightness: 0.9, contrast: 1 } };

    await processImages(order([plain, adjusted]));

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
    await processImages(target);
    const withB = order([...target.cards, { ...card('b', 1), id: 'b2' }]);
    await processImages(withB);
    const before = await fs.readdir(cardsDir(target));
    fetched = [];

    await forgetImages(withB, ['scryfall-b-front-b143-c100.jpg']);

    const after = await fs.readdir(cardsDir(target));
    assert.deepEqual(before.filter(file => !after.includes(file)).sort(), ['base-scryfall-b-front.jpg', 'scryfall-b-front-b110-c100.jpg', 'scryfall-b-front-b143-c100.jpg']);
    await processImages(withB);
    assert.deepEqual(fetched.map(url => url.replace(/^.*\//, '')), ['b.png']);
});

test('cardProfile takes the width of other cards for their bleed and upscaling, and leaves cards of 63 mm as they are', () => {
    const tarot = { ...order([]), tcg: 'other' as const, cardSize: { width: 69.8, height: 120.7 } };

    assert.equal(cardProfile(tarot).postProcessing.cardWidth, 69.8 / 25.4);
    const lorcana = { ...order([]), tcg: 'lorcana' as const };
    assert.equal(cardProfile(lorcana), lorcana.profile);
    assert.notEqual(settingsFingerprint(cardProfile(tarot)), settingsFingerprint(order([]).profile));
});
