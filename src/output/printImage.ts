import sharp from "sharp";
import { type Adjustments, CARD_SIZES, type Shop } from "../model.js";

export const BLEED_MM = 3;

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
function printImage(input: string | Buffer, { width, height }: PixelSize, adjustments: Adjustments) {
    const { brightness, contrast } = adjustments;

    // Brightness, then contrast around middle grey: the same formula as the CSS filters of the app's preview.
    return sharp(input)
        .flatten({ background: '#ffffff' })
        .resize(width, height, { fit: 'cover' })
        .linear(brightness * contrast, 128 * (1 - contrast))
        .withIccProfile('srgb', { attach: false });
}

export async function toPrintJpeg(input: string | Buffer, outputPath: string, size: PixelSize, adjustments: Adjustments) {
    await printImage(input, size, adjustments).jpeg({ quality: 95 }).toFile(outputPath);
}

// For printing at home, where the size does not matter: practically lossless, with the colours at full resolution.
export async function toFinestJpeg(input: string | Buffer, outputPath: string, size: PixelSize, adjustments: Adjustments) {
    await printImage(input, size, adjustments).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(outputPath);
}

// Lossless: a quality option would make sharp reduce the colours to a palette.
export async function toPrintPng(input: string | Buffer, outputPath: string, size: PixelSize, adjustments: Adjustments) {
    await printImage(input, size, adjustments).png().toFile(outputPath);
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
