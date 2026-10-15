import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { customImagePath } from "../config/paths.js";
import type { PostProcessingProfile } from "../model.js";
import { BLEED_MM, PAGE_HEIGHT_MM, PAGE_WIDTH_MM } from "../output/printImage.js";
import { exists } from "../utils/fs.js";

const CARD_RATIO = (PAGE_WIDTH_MM - 2 * BLEED_MM) / (PAGE_HEIGHT_MM - 2 * BLEED_MM);
const PAGE_RATIO = PAGE_WIDTH_MM / PAGE_HEIGHT_MM;

// Stored by content, so the same image is kept once and a changed image gets a new name.
export async function importCustomImage(sourcePath: string): Promise<string> {
    const image = await fs.readFile(sourcePath);
    const { width, height, format } = await sharp(image).metadata();
    if (width > height) {
        throw new Error('Landscape images are not supported, use a portrait card image.');
    }

    const file = `${createHash('sha256').update(image).digest('hex').slice(0, 16)}.${format === 'jpeg' ? 'jpg' : format}`;
    const target = customImagePath(file);
    if (!await exists(target)) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, image);
    }

    return file;
}

// Images shaped like the page (69x94 mm, e.g. MPC images) already include the bleed,
// images shaped like the card (63x88 mm) get a mirrored bleed around them.
export async function prepareCustomImage(image: Buffer, config: PostProcessingProfile): Promise<Buffer> {
    const { width, height } = await sharp(image).metadata();
    if (width / height >= (CARD_RATIO + PAGE_RATIO) / 2) {
        return await sharp(image).png().toBuffer();
    }

    const bleed = Math.round(width / config.cardWidth * config.bleedWidth);
    return await sharp(image)
        .extend({ top: bleed, bottom: bleed, left: bleed, right: bleed, extendWith: 'mirror' })
        .png()
        .toBuffer();
}
