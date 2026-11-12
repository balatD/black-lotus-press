import sharp, { type Sharp } from "sharp";
import { type Adjustments, CARD_SIZES, type Shop } from "../model.js";

export const BLEED_MM = 3;
// Darkening edges reaches over the bleed and about the border, and raises the black point by at most this much.
const EDGE_BAND = 0.095;
const MAX_BLACK_POINT = 0.25;

// Previews sit in this folder next to the images they show.
export const PREVIEW_DIR = 'previews-700';

export interface PixelSize {
    width: number;
    height: number;
}

// The card with its bleed, 69 × 94 mm for Magic.
export function pageSizeInPixels(dpi: number, card = CARD_SIZES.magic): PixelSize {
    return {
        width: Math.round((card.width + 2 * BLEED_MM) / 25.4 * dpi),
        height: Math.round((card.height + 2 * BLEED_MM) / 25.4 * dpi)
    };
}

// printerstudio.de flags images narrower than MPC's 2.72 × 3.70 inches as low resolution, and the page is 0.1 mm narrower.
export function printSizeInPixels(shop: Shop, dpi: number, card = CARD_SIZES.magic): PixelSize {
    return shop === 'printerstudio' ? { width: Math.round(2.72 * dpi), height: Math.round(3.7 * dpi) } : pageSizeInPixels(dpi, card);
}

// Shared by both formats, so the PNG uploaded to meinspiel.de shows the card exactly like the JPEG on disk.
async function printImage(input: string | Buffer, { width, height }: PixelSize, adjustments: Adjustments): Promise<Sharp> {
    const { brightness, contrast, edges } = adjustments;

    // Brightness, then contrast around middle grey: the same formula as the CSS filters of the app's preview.
    const adjusted = sharp(input)
        .flatten({ background: '#ffffff' })
        .resize(width, height, { fit: 'cover' })
        .linear(brightness * contrast, 128 * (1 - contrast));
    if (!edges) return adjusted.withIccProfile('srgb', { attach: false });

    // Raising the black point in the band makes dark borders print deep black and leaves white ones white.
    // The mask is drawn small and enlarged, so the band fades out over about a millimetre.
    const { data, info } = await adjusted.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const raw = { width: info.width, height: info.height, channels: info.channels };
    const blackPoint = MAX_BLACK_POINT * edges;
    const darkened = await sharp(data, { raw }).linear(1 / (1 - blackPoint), -255 * blackPoint / (1 - blackPoint)).raw().toBuffer();
    const small = { width: 64, height: Math.round(64 * height / width) };
    const band = Math.round(small.width * EDGE_BAND);
    const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${small.width}" height="${small.height}"><rect width="100%" height="100%" fill="#fff"/>`
        + `<rect x="${band}" y="${band}" width="${small.width - 2 * band}" height="${small.height - 2 * band}" fill="#000"/></svg>`))
        .resize(width, height, { fit: 'fill', kernel: 'linear' })
        .extractChannel(0)
        .raw()
        .toBuffer();
    const overlay = await sharp(darkened, { raw }).joinChannel(mask, { raw: { width, height, channels: 1 } }).raw().toBuffer();
    return sharp(data, { raw }).composite([{ input: overlay, raw: { width, height, channels: 4 } }]).withIccProfile('srgb', { attach: false });
}

export async function toPrintJpeg(input: string | Buffer, outputPath: string, size: PixelSize, adjustments: Adjustments) {
    await (await printImage(input, size, adjustments)).jpeg({ quality: 95 }).toFile(outputPath);
}

// For printing at home, where the size does not matter: practically lossless, with the colours at full resolution.
export async function toFinestJpeg(input: string | Buffer, outputPath: string, size: PixelSize, adjustments: Adjustments) {
    await (await printImage(input, size, adjustments)).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(outputPath);
}

// Lossless: a quality option would make sharp reduce the colours to a palette.
export async function toPrintPng(input: string | Buffer, outputPath: string, size: PixelSize, adjustments: Adjustments) {
    await (await printImage(input, size, adjustments)).png().toFile(outputPath);
}

export async function whitePage(size: PixelSize) {
    return await sharp({ create: { ...size, channels: 3, background: '#ffffff' } }).png().toBuffer();
}

export async function createBlankPrintJpeg(outputPath: string, size: PixelSize) {
    await toPrintJpeg(await whitePage(size), outputPath, size, { brightness: 1, contrast: 1 });
}

// Small sRGB copy for screens. CMYK images are converted with the default CMYK profile, so the colours are approximate.
export async function writePreview(image: string, outputPath: string) {
    await sharp(image)
        .resize(700)
        .toColourspace('srgb')
        .jpeg({ quality: 80 })
        .toFile(outputPath);
}
