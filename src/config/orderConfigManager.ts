import fs from 'node:fs/promises';
import { DefaultOrder, type Order } from "../model.js";
import { dataPath } from "./paths.js";
import { readJsonFiles, writeJsonFile } from "./jsonStore.js";

function orderFile(name: string) {
    return dataPath('config', 'orders', `${name}.json`);
}

// Orders saved by older versions carry `states` instead of `cards`; their decks get imported again.
function fromJson(json: unknown): Order {
    const { states: _states, ...order } = json as Partial<Order> & { states?: unknown };
    return { ...DefaultOrder, ...order, cards: order.cards ?? [] };
}

export async function loadOrders(): Promise<Order[]> {
    const orders = (await readJsonFiles(dataPath('config', 'orders'))).map(fromJson);
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
