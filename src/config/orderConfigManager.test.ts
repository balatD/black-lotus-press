import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deleteOrder, loadOrders, saveOrder } from "./orderConfigManager.js";
import { DefaultOrder } from "../model.js";
import { setDataRoot } from "./paths.js";

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

test('loadOrders gives orders saved before there was a choice of shop to meinspiel.de', async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, 'config', 'orders'), { recursive: true });
    const { shop: _, ...older } = { ...DefaultOrder, name: 'sauron' };
    await fs.writeFile(path.join(root, 'config', 'orders', 'sauron.json'), JSON.stringify(older));

    assert.equal((await loadOrders())[0]?.shop, 'meinspiel');
});
