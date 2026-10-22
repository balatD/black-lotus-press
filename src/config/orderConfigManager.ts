import fs from 'node:fs/promises';
import { DefaultOrder, isValidOrderName, type Order, type Shop } from "../model.js";
import { dataPath, orderDir } from "./paths.js";
import { readJsonFiles, writeJsonFile } from "./jsonStore.js";
import { copyBaseImages, forgetPrintImages } from "../pipeline/processImages.js";
import { exists, renameWithRetry } from "../utils/fs.js";

function orderFile(name: string) {
    return dataPath('config', 'orders', `${name}.json`);
}

// Orders saved by older versions carry `states` instead of `cards`; their decks get imported again.
function fromJson(json: unknown): Order {
    const { states: _states, ...order } = json as Partial<Order> & { states?: unknown };
    return { ...DefaultOrder, ...order, cards: order.cards ?? [] };
}

export async function loadOrders(onUnreadable?: (file: string) => void): Promise<Order[]> {
    const orders = (await readJsonFiles(dataPath('config', 'orders'), onUnreadable)).map(fromJson);
    return orders.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadOrder(name: string): Promise<Order> {
    return fromJson(JSON.parse(await fs.readFile(orderFile(name), 'utf-8')));
}

export async function saveOrder(order: Order): Promise<void> {
    await writeJsonFile(orderFile(order.name), order);
}

export async function deleteOrder(order: Order): Promise<void> {
    await fs.unlink(orderFile(order.name));
}

export async function moveOrder(order: Order, shop: Shop): Promise<void> {
    await saveOrder({ ...order, shop });
    await forgetPrintImages(order);
}

// Orders of every shop share one folder, so the name must be free in all of them.
async function assertFreeName(name: string) {
    if (!isValidOrderName(name)) throw new Error(`Invalid order name: "${name}"`);
    if (await exists(orderFile(name))) throw new Error(`An order named "${name}" exists already.`);
}

export async function copyOrder(order: Order, shop: Shop, name: string): Promise<void> {
    await assertFreeName(name);

    // The games of the last upload belong to the original.
    const { uploaded: _, ...rest } = order;
    const copy: Order = { ...rest, name, shop };
    await copyBaseImages(order, copy);
    await saveOrder(copy);
}

// The folder moves first, as it is the step most likely to fail, which then leaves everything as it was.
export async function renameOrder(order: Order, name: string): Promise<void> {
    await assertFreeName(name);
    const renamed = { ...order, name };
    // Deleting an order leaves its folder behind.
    if (await exists(orderDir(renamed))) throw new Error(`The orders folder has a folder named "${name}" already.`);

    if (await exists(orderDir(order))) await renameWithRetry(orderDir(order), orderDir(renamed));
    await saveOrder(renamed);
    await deleteOrder(order);
}
