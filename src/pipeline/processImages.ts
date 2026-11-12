import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import Bottleneck from "bottleneck";
import sharp from "sharp";
import { cardsDir, customImagePath } from "../config/paths.js";
import { CARD_SIZES, cardSize, type OnProgress, type Order, type ProcessingProfile, TCG_SOURCES } from "../model.js";
import { BLANK_FACE, buildPacks, cardBackFace, cardFaces, type Face, faceImageUris, type FaceSource } from "./packs.js";
import { fetchScryfallImage } from "../clients/scryfall.js";
import { downloadDriveImage } from "../clients/googleDrive.js";
import { cacheTcgImage } from "../clients/tcgImages.js";
import { fixCorners, postProcessImage } from "./postProcessing.js";
import { upscaleImage } from "./upscayl.js";
import { prepareCustomImage } from "./customImage.js";
import { BLEED_MM, createBlankPrintJpeg, PREVIEW_DIR, printSizeInPixels, toFinestJpeg, toPrintJpeg, toPrintPng, whitePage } from "../output/printImage.js";
import { exists, renameWithRetry } from "../utils/fs.js";

type CardSize = typeof CARD_SIZES.magic;

// Bump whenever a code change alters the processed images, so existing caches get rebuilt.
export const PIPELINE_VERSION = 2;

// Settings that change the base images. Brightness and contrast are not part of it: they only change the print images.
export function settingsFingerprint(profile: ProcessingProfile) {
    const { postProcessing: p, upscaling: u } = profile;
    // The own text is only added when printed, so caches of the other modes stay valid.
    const text = p.copyrightBehavior === 'custom' ? [p.copyrightText ?? ''] : [];
    return JSON.stringify([PIPELINE_VERSION, p.dpi, p.cardWidth, p.cornerRadius, p.bleedWidth, p.borderCrop, p.copyrightBehavior, p.blurStrength, u.enabled, u.model, ...text]);
}

// Yu-Gi-Oh cards are narrower, other cards may have any width. The card width sets their bleed and upscaling, and as part of the
// fingerprint keeps their images apart.
export function cardProfile(order: Pick<Order, 'tcg' | 'cardSize' | 'profile'>): ProcessingProfile {
    const { width } = cardSize(order);
    if (width === CARD_SIZES.magic.width) return order.profile;
    return { ...order.profile, postProcessing: { ...order.profile.postProcessing, cardWidth: width / 25.4 } };
}

// Only the faces that end up in a pack, so excluded cards and dropped tokens cost nothing.
export function faceJobs(order: Order): Map<string, Face> {
    const cards = new Map(order.cards.map(card => [card.id, card]));
    const jobs = new Map<string, Face>();
    const add = (face: Face) => jobs.set(face.file, face);

    for (const slot of buildPacks(order).packs.flat()) {
        const card = slot.cardId === undefined ? undefined : cards.get(slot.cardId);
        const faces = card && cardFaces(card, order);
        // Home prints the fronts, the back of a double-faced card as the front of a slot of its own, unless it prints both sides.
        if (order.shop === 'home') {
            if (faces) add(faces.back.file === slot.front ? faces.back : faces.front);
            if (faces && order.homePrint?.sides === 'both') add(faces.back);
        } else if (faces) {
            add(faces.front);
            add(faces.back);
        } else {
            add(BLANK_FACE);
            add(cardBackFace(order));
        }
    }

    return jobs;
}

// Given faces, only those are made, and the images of the other cards stay.
export async function processImages(order: Order, onProgress?: OnProgress, signal?: AbortSignal, faces?: Face[]) {
    const dir = cardsDir(order);
    const tmpDir = path.join(dir, '.tmp');
    const profile = cardProfile(order);
    const size = printSizeInPixels(order.shop, profile.postProcessing.dpi, cardSize(order));
    await prepareCache(dir, settingsFingerprint(profile));
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });

    const jobs = faces ?? [...faceJobs(order).values()];
    const pending: Face[] = [];
    for (const face of jobs) {
        if (!await exists(path.join(dir, face.file))) pending.push(face);
    }

    let done = jobs.length - pending.length;
    const report = (message: string) => onProgress?.({ type: 'progress', done, total: jobs.length, message });
    report('Processing card images');

    // Print images with different adjustments share one base image, which must only be rendered once.
    const bases = new Map<string, Promise<void>>();
    const ensureBase = (face: Face, base: string) => {
        let job = bases.get(base);
        if (!job) {
            job = renderBase(face.source, base, dir, tmpDir, profile, cardSize(order), signal)
                .then(async () => onProgress?.({ type: 'face-ready', file: base, bytes: (await fs.stat(path.join(dir, base))).size }));
            bases.set(base, job);
        }
        return job;
    };

    const failures: string[] = [];
    const pool = new Bottleneck({ maxConcurrent: 4 });
    await Promise.all(pending.map(face => pool.schedule(async () => {
        if (signal?.aborted) return;

        try {
            const tmpFile = path.join(tmpDir, face.file);
            if (face.base && face.adjustments) {
                await ensureBase(face, face.base);
                const base = path.join(dir, face.base);
                if (order.shop === 'home') await toFinestJpeg(base, tmpFile, await ownPrintSize(order, base), face.adjustments);
                else await toPrintJpeg(base, tmpFile, size, face.adjustments);
            } else {
                await createBlankPrintJpeg(tmpFile, size);
            }
            signal?.throwIfAborted();

            const target = path.join(dir, face.file);
            await renameWithRetry(tmpFile, target);
            onProgress?.({ type: 'face-ready', file: face.file, bytes: (await fs.stat(target)).size });
        } catch (error) {
            if (signal?.aborted) return;

            const message = `${describe(face.source)}: ${error instanceof Error ? error.message : String(error)}`;
            failures.push(message);
            onProgress?.({ type: 'face-failed', file: face.file, error: message });
        }

        done++;
        report(`Processed ${describe(face.source)}`);
    })));

    signal?.throwIfAborted();
    if (failures.length > 0) {
        throw new Error(`${failures.length} card image(s) could not be processed:\n${failures.join('\n')}`);
    }

    if (!faces) await removeUnusedPrintImages(dir, new Set(jobs.map(face => face.file)));
}

// The profile's resolution is the least: a base image with more, like most MPC Autofill images, keeps its own.
async function ownPrintSize(order: Order, base: string) {
    const { width, height } = await sharp(base).metadata();
    const card = cardSize(order);
    const own = Math.min(width / (card.width + 2 * BLEED_MM), height / (card.height + 2 * BLEED_MM)) * 25.4;
    return printSizeInPixels(order.shop, Math.max(order.profile.postProcessing.dpi, own), card);
}

// The print image of a face as a lossless PNG for meinspiel.de, made from the base image like the JPEG on disk.
export async function writePrintPng(order: Order, face: Face, outputPath: string) {
    if (!face.base || !face.adjustments) {
        const size = printSizeInPixels(order.shop, order.profile.postProcessing.dpi);
        await toPrintPng(await whitePage(size), outputPath, size, { brightness: 1, contrast: 1 });
        return;
    }

    const base = path.join(cardsDir(order), face.base);
    await toPrintPng(base, outputPath, await ownPrintSize(order, base), face.adjustments);
}

// Deletes the base images of these faces and every print image made from them, so the next run makes them anew.
// Unknown files and blank cards are skipped.
export async function forgetImages(order: Order, files: string[]) {
    const dir = cardsDir(order);
    const faces = faceJobs(order);
    const stems = files.flatMap(file => {
        const base = faces.get(file)?.base;
        return base ? [base.slice('base-'.length, -'.jpg'.length)] : [];
    });
    if (stems.length === 0) return;

    for (const file of await fs.readdir(dir).catch(() => [])) {
        if (!stems.some(stem => file === `base-${stem}.jpg` || file.startsWith(`${stem}-b`))) continue;
        await fs.rm(path.join(dir, file), { force: true });
        await fs.rm(path.join(dir, PREVIEW_DIR, file), { force: true });
    }
}

// For an order that moves to another shop: its print images have the old shop's colours and size.
// The base images stay, so making the print images anew only takes seconds.
export async function forgetPrintImages(order: Order) {
    const dir = cardsDir(order);
    if (await exists(dir)) await removeUnusedPrintImages(dir, new Set());
}

// For a copy of the order with the same profile, so it neither downloads nor upscales anything again.
export async function copyBaseImages(from: Order, to: Order) {
    const source = cardsDir(from);
    if (!await exists(path.join(source, 'cache.json'))) return;

    const target = cardsDir(to);
    await fs.mkdir(target, { recursive: true });
    for (const file of await fs.readdir(source)) {
        if (file !== 'cache.json' && !file.startsWith('base-')) continue;
        await fs.copyFile(path.join(source, file), path.join(target, file), fs.constants.COPYFILE_FICLONE);
    }
}

// The base images in the order's packs with the file that keeps them valid, to take them to another computer.
export async function usedBaseImages(order: Order): Promise<string[]> {
    const dir = cardsDir(order);
    if (await cachedSettings(dir) !== settingsFingerprint(cardProfile(order))) return [];

    const files = ['cache.json'];
    for (const base of new Set([...faceJobs(order).values()].map(face => face.base))) {
        if (base && await exists(path.join(dir, base))) files.push(base);
    }
    return files;
}

// Processed images of the order and their sizes. Images made with other settings do not count.
export async function imageStatus(order: Order): Promise<{ version: string, files: Record<string, number> }> {
    const dir = cardsDir(order);
    const settings = settingsFingerprint(cardProfile(order));
    if (await cachedSettings(dir) !== settings) return { version: '', files: {} };

    const files: Record<string, number> = {};
    for (const file of await fs.readdir(dir)) {
        if (file.endsWith('.jpg')) files[file] = (await fs.stat(path.join(dir, file))).size;
    }

    return { version: createHash('sha1').update(settings).digest('hex').slice(0, 8), files };
}

async function cachedSettings(dir: string): Promise<string | undefined> {
    return await fs.readFile(path.join(dir, 'cache.json'), 'utf-8').then(json => JSON.parse(json).settings, () => undefined);
}

async function prepareCache(dir: string, settings: string) {
    if (await cachedSettings(dir) === settings) return;

    // Images made with other settings must not end up in print.
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'cache.json'), JSON.stringify({ settings }));
}

// Print images of earlier adjustments; the base images stay, so going back is cheap.
async function removeUnusedPrintImages(dir: string, used: Set<string>) {
    for (const file of await fs.readdir(dir)) {
        if (!file.endsWith('.jpg') || file.startsWith('base-') || used.has(file)) continue;
        await fs.rm(path.join(dir, file), { force: true });
        await fs.rm(path.join(dir, PREVIEW_DIR, file), { force: true });
    }
}

async function renderBase(source: FaceSource, base: string, dir: string, tmpDir: string, profile: ProcessingProfile, card: CardSize, signal?: AbortSignal) {
    const target = path.join(dir, base);
    if (await exists(target)) return;

    const tmpFile = path.join(tmpDir, base);
    const image = await baseImage(source, tmpFile, profile, card, signal);
    await sharp(image).flatten({ background: '#ffffff' }).jpeg({ quality: 97 }).toFile(tmpFile);
    signal?.throwIfAborted();
    await renameWithRetry(tmpFile, target);
}

async function baseImage(source: FaceSource, tmpFile: string, profile: ProcessingProfile, card: CardSize, signal?: AbortSignal): Promise<Buffer> {
    switch (source.type) {
        // MPC Autofill images and card backs keep their resolution; only those below the profile's are upscaled.
        case 'cardback':
            return await upscale(await downloadDriveImage(source.driveId), tmpFile, profile, signal);
        case 'scryfall': {
            const url = faceImageUris(source.printing, source.face)?.png;
            if (!url) throw new Error('Scryfall has no image for this face');

            const processed = await postProcessImage(await fetchScryfallImage(url), source.printing, source.face, profile.postProcessing);
            return await upscale(processed, tmpFile, profile, signal);
        }
        case 'custom': {
            const prepared = await prepareCustomImage(await fs.readFile(customImagePath(source.image)), profile.postProcessing, card);
            return await upscale(prepared, tmpFile, profile, signal);
        }
        case 'mpcfill':
            return await upscale(await prepareCustomImage(await downloadDriveImage(source.id), profile.postProcessing, card), tmpFile, profile, signal);
        case 'tcg': {
            let image: Buffer = await fs.readFile(await cacheTcgImage(source.card.image));
            // TCGdex scans have transparent rounded corners and are a little wider than the card; optcgapi.com images have such corners too.
            if (source.card.tcg === 'pokemon' || source.card.tcg === 'onepiece') {
                const { width } = await sharp(image).metadata();
                image = await sharp(await fixCorners(image, profile.postProcessing)).resize(width, Math.round(width * card.height / card.width), { fit: 'fill' }).png().toBuffer();
            }
            return await upscale(await prepareCustomImage(image, profile.postProcessing, card), tmpFile, profile, signal);
        }
        case 'blank':
            throw new Error('Blank cards have no base image');
    }
}

// Upscayl works on files, so the image takes a detour through a PNG next to the output.
async function upscale(image: Buffer, out: string, profile: ProcessingProfile, signal?: AbortSignal) {
    if (!profile.upscaling.enabled) return image;

    const png = out.replace(/\.jpg$/, '.png');
    await fs.writeFile(png, image);
    try {
        await upscaleImage(png, profile.postProcessing, profile.upscaling, signal);
        return await fs.readFile(png);
    } finally {
        await fs.rm(png, { force: true });
    }
}

function describe(source: FaceSource) {
    switch (source.type) {
        case 'scryfall':
            return `${source.printing.name} (${source.printing.set.toUpperCase()} ${source.printing.collector_number}, ${source.face})`;
        case 'custom':
            return `own image ${source.image}`;
        case 'mpcfill':
            return `MPC Autofill image ${source.id}`;
        case 'cardback':
            return `card back ${source.driveId}`;
        case 'tcg':
            return `${TCG_SOURCES[source.card.tcg]} card ${source.card.id}`;
        case 'blank':
            return 'blank card';
    }
}
