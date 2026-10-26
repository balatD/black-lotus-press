import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { copyOrder, deleteOrder, exportOrder, importOrder, loadOrders, moveOrder, renameOrder, saveOrder } from "./orderConfigManager.js";
import { DefaultOrder, DefaultProfile, type Order, type OrderCard, PlaywrightChannel, type ProcessingProfile } from "../model.js";
import { cardsDir, customImagePath, orderDir, setDataRoot } from "./paths.js";
import { PREVIEW_DIR } from "../output/printImage.js";
import { cardFaces } from "../pipeline/packs.js";
import { imageStatus, settingsFingerprint } from "../pipeline/processImages.js";
import { UPSCAYL_BINARY, UPSCAYL_MODELS } from "../pipeline/upscayl.js";
import { exists } from "../utils/fs.js";

afterEach(() => setDataRoot(process.cwd()));

async function tempRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-forge-'));
    setDataRoot(root);
    return root;
}

test('orders are saved under the data root and loaded back', async () => {
    const root = await tempRoot();

    await saveOrder({ ...DefaultOrder, name: 'sauron' });

    assert.deepEqual(await fs.readdir(path.join(root, 'config', 'orders')), ['sauron.json']);
    assert.deepEqual((await loadOrders()).map(order => order.name), ['sauron']);
});

test('loadOrders ignores files that are not JSON', async () => {
    const root = await tempRoot();
    await saveOrder({ ...DefaultOrder, name: 'sauron' });
    await fs.writeFile(path.join(root, 'config', 'orders', '.DS_Store'), 'binary junk');

    assert.deepEqual((await loadOrders()).map(order => order.name), ['sauron']);
});

test('loadOrders skips an order file it cannot read, names it and leaves it as it is', async () => {
    const root = await tempRoot();
    await saveOrder({ ...DefaultOrder, name: 'sauron' });
    const broken = path.join(root, 'config', 'orders', 'broken.json');
    await fs.writeFile(broken, '{"name":');
    const unreadable: string[] = [];

    assert.deepEqual((await loadOrders(file => unreadable.push(file))).map(order => order.name), ['sauron']);
    assert.deepEqual(unreadable, [broken]);
    assert.equal(await fs.readFile(broken, 'utf-8'), '{"name":');
});

test('deleteOrder removes the file', async () => {
    await tempRoot();
    const order = { ...DefaultOrder, name: 'sauron' };
    await saveOrder(order);

    await deleteOrder(order);

    assert.deepEqual(await loadOrders(), []);
});

test('loadOrders converts orders saved with processing states', async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, 'config', 'orders'), { recursive: true });
    const legacy = { name: 'sauron', profile: DefaultOrder.profile, decks: [], cardBack: 'drive1', states: [{ id: 'x', state: 'converted' }] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'sauron.json'), JSON.stringify(legacy));

    const [order] = await loadOrders();

    assert.deepEqual(order?.cards, []);
    assert.equal(order?.cardBack, 'drive1');
    assert.ok(!('states' in order!));
});

// Processed images as processImages leaves them: base images, print images with their previews, and the settings.
async function processedImages(order: Order) {
    const dir = cardsDir(order);
    await fs.mkdir(path.join(dir, PREVIEW_DIR), { recursive: true });
    for (const file of ['cache.json', 'base-scryfall-a-front.jpg', 'scryfall-a-front-b110-c100.jpg', 'blank.jpg', `${PREVIEW_DIR}/scryfall-a-front-b110-c100.jpg`]) {
        await fs.writeFile(path.join(dir, file), file);
    }
}

async function files(order: Order) {
    return (await fs.readdir(cardsDir(order), { recursive: true })).filter(file => file !== PREVIEW_DIR).sort();
}

test('moveOrder gives the order to another shop and drops the print images, but keeps the base images', async () => {
    await tempRoot();
    const order: Order = { ...DefaultOrder, name: 'sauron', cardBack: 'drive1' };
    await saveOrder(order);
    await processedImages(order);

    await moveOrder(order, 'printerstudio');

    assert.deepEqual((await loadOrders()).map(saved => [saved.name, saved.shop, saved.cardBack]), [['sauron', 'printerstudio', 'drive1']]);
    assert.deepEqual(await files(order), ['base-scryfall-a-front.jpg', 'cache.json']);
});

test('copyOrder saves a copy for another shop with the base images, without the upload of the original', async () => {
    await tempRoot();
    const order: Order = { ...DefaultOrder, name: 'sauron', uploaded: { at: '2026-10-19T12:00:00.000Z', games: [] } };
    await saveOrder(order);
    await processedImages(order);

    await copyOrder(order, 'notmpc', 'sauron eu');

    const [original, copy] = await loadOrders();
    assert.deepEqual([copy?.name, copy?.shop, copy?.uploaded], ['sauron eu', 'notmpc', undefined]);
    assert.deepEqual([original?.name, original?.shop, original?.uploaded], ['sauron', 'meinspiel', order.uploaded]);
    assert.deepEqual(await files(copy!), ['base-scryfall-a-front.jpg', 'cache.json']);
    assert.equal((await files(order)).length, 5, 'the original keeps all its images');
});

test('copyOrder refuses a name that is taken or invalid', async () => {
    await tempRoot();
    const order: Order = { ...DefaultOrder, name: 'sauron' };
    await saveOrder(order);
    await saveOrder({ ...order, name: 'urza', shop: 'notmpc' });

    await assert.rejects(copyOrder(order, 'printerstudio', 'urza'), /exists already/);
    await assert.rejects(copyOrder(order, 'printerstudio', '../urza'), /Invalid order name/);
    assert.deepEqual((await loadOrders()).map(saved => [saved.name, saved.shop]), [['sauron', 'meinspiel'], ['urza', 'notmpc']]);
});

test('renameOrder takes the images, the PDFs and the last upload along to the new name', async () => {
    await tempRoot();
    const uploaded = { at: '2026-10-22T10:00:00.000Z', games: [{ id: 1, name: 'sauron - Deck 1/1', saved: true, url: 'https://www.meinspiel.de/konfigurator/game/1?tid=10098' }] };
    const order: Order = { ...DefaultOrder, name: 'sauron', uploaded };
    await saveOrder(order);
    await processedImages(order);
    await fs.mkdir(path.join(orderDir(order), 'meinspiel'));
    await fs.writeFile(path.join(orderDir(order), 'meinspiel', 'pack-01-fronts.pdf'), 'pdf');

    await renameOrder(order, 'sauron deck');

    const renamed = { ...order, name: 'sauron deck' };
    assert.deepEqual((await loadOrders()).map(saved => [saved.name, saved.uploaded]), [['sauron deck', uploaded]]);
    assert.equal((await files(renamed)).length, 5);
    assert.equal(await fs.readFile(path.join(orderDir(renamed), 'meinspiel', 'pack-01-fronts.pdf'), 'utf-8'), 'pdf');
    await assert.rejects(fs.stat(orderDir(order)), /ENOENT/);
});

test('renameOrder refuses a name that is taken, invalid or the name of a folder left in the orders folder', async () => {
    await tempRoot();
    const order: Order = { ...DefaultOrder, name: 'sauron' };
    await saveOrder(order);
    await saveOrder({ ...order, name: 'urza', shop: 'notmpc' });
    await fs.mkdir(orderDir({ ...order, name: 'deleted' }), { recursive: true });

    await assert.rejects(renameOrder(order, 'urza'), /exists already/);
    await assert.rejects(renameOrder(order, '../urza'), /Invalid order name/);
    await assert.rejects(renameOrder(order, 'deleted'), /folder/);
    assert.deepEqual((await loadOrders()).map(saved => saved.name), ['sauron', 'urza']);
});

test('loadOrders gives orders saved before there was a choice of shop to meinspiel.de', async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, 'config', 'orders'), { recursive: true });
    const { shop: _, ...older } = { ...DefaultOrder, name: 'sauron' };
    await fs.writeFile(path.join(root, 'config', 'orders', 'sauron.json'), JSON.stringify(older));

    assert.equal((await loadOrders())[0]?.shop, 'meinspiel');
});

const OWN_IMAGE = '0123456789abcdef.png';
const ownCard: OrderCard = { id: 'a', deck: 'deck', board: 'mainboard', name: 'Sauron', quantity: 1, isToken: false, excluded: false, customImage: { front: OWN_IMAGE } };
// The profile of the same name on the friend's computer, with its own folders and browser.
const friendsProfile: ProcessingProfile = {
    ...DefaultProfile, name: 'mine', outputDirectory: './friend', playwrightChannel: PlaywrightChannel.MicrosoftEdge,
    upscaling: { ...DefaultProfile.upscaling, binaryFile: './bin/upscayl', modelsDirectory: './bin/models' }
};

// An order with an own image, processed images, a base image no card uses any more and an upload to the sender's account.
async function sentOrder() {
    await tempRoot();
    const profile: ProcessingProfile = {
        ...DefaultProfile, name: 'mine', outputDirectory: './sent', postProcessing: { ...DefaultProfile.postProcessing, dpi: 600 },
        upscaling: { enabled: true, binaryFile: '/sender/upscayl-bin', modelsDirectory: '/sender/models', model: 'high-fidelity-4x' }
    };
    const order: Order = {
        ...DefaultOrder, name: 'sauron', shop: 'printerstudio', profile, cardBack: 'drive1', cards: [ownCard], adjustments: { brightness: 1.2, contrast: 1 },
        uploaded: { at: '2026-10-22T10:00:00.000Z', games: [] }
    };
    await saveOrder(order);
    await fs.mkdir(path.dirname(customImagePath(OWN_IMAGE)), { recursive: true });
    await fs.writeFile(customImagePath(OWN_IMAGE), 'own image');

    const { front, back } = cardFaces(ownCard, order)!;
    await fs.mkdir(cardsDir(order), { recursive: true });
    await fs.writeFile(path.join(cardsDir(order), 'cache.json'), JSON.stringify({ settings: settingsFingerprint(profile) }));
    for (const file of [front.base!, front.file, back.base!, back.file, 'base-scryfall-old-front.jpg']) {
        await fs.writeFile(path.join(cardsDir(order), file), file);
    }
    return order;
}

async function exported(order: Order, withImages: boolean) {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'order-file-')), `${order.name}.zip`);
    await exportOrder(order, file, withImages);
    return file;
}

test('importOrder brings an order exported with images to another computer with its own image and the base images it uses', async () => {
    const order = await sentOrder();
    const file = await exported(order, true);
    await tempRoot();

    const imported = await importOrder(file, [DefaultProfile, friendsProfile]);

    assert.deepEqual(await loadOrders(), [imported]);
    assert.deepEqual([imported.name, imported.shop, imported.cardBack, imported.cards, imported.adjustments, imported.uploaded],
        ['sauron', 'printerstudio', 'drive1', order.cards, order.adjustments, undefined]);
    assert.deepEqual(imported.profile, {
        ...order.profile, outputDirectory: './friend', playwrightChannel: PlaywrightChannel.MicrosoftEdge,
        upscaling: { ...order.profile.upscaling, binaryFile: './bin/upscayl', modelsDirectory: './bin/models' }
    });
    assert.deepEqual(await files(imported), ['base-cardback-drive1.jpg', 'base-custom-0123456789abcdef.jpg', 'cache.json']);
    assert.deepEqual(Object.keys((await imageStatus(imported)).files).sort(), ['base-cardback-drive1.jpg', 'base-custom-0123456789abcdef.jpg']);
    assert.equal(await fs.readFile(customImagePath(OWN_IMAGE), 'utf-8'), 'own image');
});

test('importOrder of an order exported without images brings only its own image, and finds Upscayl where the app installs it', async () => {
    const order = await sentOrder();
    const file = await exported(order, false);
    await tempRoot();

    const imported = await importOrder(file, []);

    assert.equal(await exists(cardsDir(imported)), false);
    assert.equal(await fs.readFile(customImagePath(OWN_IMAGE), 'utf-8'), 'own image');
    assert.equal(imported.profile.outputDirectory, DefaultProfile.outputDirectory);
    assert.deepEqual(imported.profile.upscaling, { ...order.profile.upscaling, binaryFile: UPSCAYL_BINARY, modelsDirectory: UPSCAYL_MODELS });
});

test('importOrder gives the order a free name when an order or a folder left in the orders folder has its name', async () => {
    const file = await exported(await sentOrder(), false);
    await tempRoot();
    await saveOrder({ ...DefaultOrder, name: 'sauron' });
    await fs.mkdir(orderDir({ ...DefaultOrder, name: 'sauron (1)' }), { recursive: true });

    assert.equal((await importOrder(file, [])).name, 'sauron (2)');
});

test('importOrder writes only the order\'s own image and base images of the file', async () => {
    const file = await exported(await sentOrder(), true);
    const zip = new AdmZip(await fs.readFile(file));
    zip.addFile('cards/custom-0123456789abcdef-b120-c100.jpg', Buffer.from('print image'));
    // addFile cleans the name, setting it afterwards does not.
    zip.addFile('evil.png', Buffer.from('evil')).entryName = '../evil.png';
    await fs.writeFile(file, zip.toBuffer());
    const root = await tempRoot();

    const imported = await importOrder(file, []);

    assert.deepEqual(await files(imported), ['base-cardback-drive1.jpg', 'base-custom-0123456789abcdef.jpg', 'cache.json']);
    assert.equal(await exists(path.join(root, '..', 'evil.png')), false);
});

test('importOrder refuses a file that is no exported order or names files outside the app, and writes nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'order-file-'));
    async function orderFile(name: string, order?: object) {
        const zip = new AdmZip();
        if (order) zip.addFile('order.json', Buffer.from(JSON.stringify(order)));
        await fs.writeFile(path.join(dir, name), zip.toBuffer());
        return path.join(dir, name);
    }
    const sauron = { ...DefaultOrder, name: 'sauron', cards: [ownCard] };
    await fs.writeFile(path.join(dir, 'deck.txt'), 'no zip');
    const root = await tempRoot();

    await assert.rejects(importOrder(path.join(dir, 'deck.txt'), []), /deck.txt is not an order exported from Black Lotus Press/);
    await assert.rejects(importOrder(await orderFile('empty.zip'), []), /empty.zip is not an order exported from Black Lotus Press/);
    await assert.rejects(importOrder(await orderFile('name.zip', { ...sauron, name: '../sauron' }), []), /Invalid order name/);
    await assert.rejects(importOrder(await orderFile('image.zip', { ...sauron, cards: [{ ...ownCard, customImage: { front: '../../.ssh/id_rsa' } }] }), []), /Invalid file name/);
    await assert.rejects(importOrder(await orderFile('back.zip', { ...sauron, cardBack: '../drive1' }), []), /Invalid file name/);
    assert.deepEqual(await fs.readdir(root), []);
});
