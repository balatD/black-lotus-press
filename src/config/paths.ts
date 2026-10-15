import path from "node:path";
import { isValidOrderName, type Order } from "../model.js";

let dataRoot = process.cwd();

export function setDataRoot(root: string) {
    dataRoot = root;
}

export function dataPath(...segments: string[]) {
    return path.join(dataRoot, ...segments);
}

export function resolveDataPath(target: string) {
    return path.resolve(dataRoot, target);
}

export function orderDir(order: Pick<Order, 'name' | 'profile'>) {
    // Guards the folders that get deleted when the processing settings change.
    if (!isValidOrderName(order.name)) throw new Error(`Invalid order name: "${order.name}"`);
    return path.join(resolveDataPath(order.profile.outputDirectory), order.name);
}

export function cardsDir(order: Pick<Order, 'name' | 'profile'>) {
    return path.join(orderDir(order), 'cards');
}

// Own card images, shared by all orders.
export function customImagePath(file: string) {
    return dataPath('config', 'images', file);
}
