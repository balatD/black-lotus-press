import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { DefaultOrder, DefaultProfile, isValidOrderName, type Order, type ProcessingProfile, type Shop } from "../model.js";
import { cardsDir, customImagePath, dataPath, orderDir } from "./paths.js";
import { readJsonFiles, writeJsonFile } from "./jsonStore.js";
import { copyBaseImages, forgetPrintImages, usedBaseImages } from "../pipeline/processImages.js";
import { UPSCAYL_BINARY, UPSCAYL_MODELS } from "../pipeline/upscayl.js";
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

const ORDER_ENTRY = 'order.json';
// An import writes nothing else, so a file from someone else cannot put files anywhere.
const IMAGE_ENTRY = /^(images\/[\w-]+\.\w+|cards\/(cache\.json|base-[\w-]+\.jpg))$/;
const FILE_ID = /^[\w-]*(\.\w+)?$/;

// For another computer, without the games of the last upload, which belong to this one's meinspiel.de account.
// The entries are stored, as images hardly compress.
export async function exportOrder(order: Order, file: string, withImages: boolean): Promise<void> {
    const zip = new AdmZip();
    const add = (entry: string, data: Buffer) => zip.addFile(entry, data).header.method = 0;

    const { uploaded: _, ...shared } = order;
    add(ORDER_ENTRY, Buffer.from(JSON.stringify(shared)));
    const images = order.cards.flatMap(card => [card.customImage?.front, card.customImage?.back]).filter(image => image !== undefined);
    for (const image of new Set(images)) add(`images/${image}`, await fs.readFile(customImagePath(image)));
    if (withImages) {
        for (const file of await usedBaseImages(order)) add(`cards/${file}`, await fs.readFile(path.join(cardsDir(order), file)));
    }

    await fs.writeFile(file, zip.toBuffer());
}

// Keeps the processing settings of the sender, so the base images stay valid; folders and programs are those of this computer.
// Takes a free name, also not one of a folder left behind by a deleted order, whose images would mix with these.
export async function importOrder(file: string, profiles: ProcessingProfile[]): Promise<Order> {
    const zip = openZip(await fs.readFile(file));
    const json = zip?.getEntry(ORDER_ENTRY)?.getData().toString('utf-8');
    if (!zip || json === undefined) throw new Error(`${path.basename(file)} is not an order exported from Black Lotus Press.`);

    const shared = fromJson(JSON.parse(json));
    if (!isValidOrderName(shared.name)) throw new Error(`Invalid order name: "${shared.name}"`);
    // These ids become file names.
    const ids = shared.cards.flatMap(card => [card.printing?.id, card.customImage?.front, card.customImage?.back, card.mpcfill?.front, card.mpcfill?.back]);
    const unsafe = [shared.cardBack, ...ids].find(id => id !== undefined && !FILE_ID.test(id));
    if (unsafe !== undefined) throw new Error(`Invalid file name in the order: "${unsafe}"`);

    const local = profiles.find(profile => profile.name === shared.profile.name) ?? profiles[0] ?? DefaultProfile;
    const profile: ProcessingProfile = {
        ...shared.profile,
        outputDirectory: local.outputDirectory,
        playwrightChannel: local.playwrightChannel,
        upscaling: { ...shared.profile.upscaling, binaryFile: local.upscaling.binaryFile ?? UPSCAYL_BINARY, modelsDirectory: local.upscaling.modelsDirectory ?? UPSCAYL_MODELS }
    };
    let name = shared.name;
    for (let n = 1; await exists(orderFile(name)) || await exists(orderDir({ name, profile })); n++) name = `${shared.name} (${n})`;
    const order: Order = { ...shared, name, profile };

    for (const entry of zip.getEntries()) {
        if (!IMAGE_ENTRY.test(entry.entryName)) continue;
        const [folder, image] = entry.entryName.split('/') as [string, string];
        const target = folder === 'images' ? customImagePath(image) : path.join(cardsDir(order), image);
        // Own images are named after their content, so the one there is the same.
        if (folder === 'images' && await exists(target)) continue;
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.getData());
    }

    await saveOrder(order);
    return order;
}

function openZip(data: Buffer): AdmZip | undefined {
    try {
        return new AdmZip(data);
    } catch {
        return undefined;
    }
}
