import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyOrder, deleteOrder, loadOrders, moveOrder, renameOrder, saveOrder } from "./orderConfigManager.js";
import { DefaultOrder, type Order } from "../model.js";
import { cardsDir, orderDir, setDataRoot } from "./paths.js";
import { PREVIEW_DIR } from "../output/printImage.js";

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
