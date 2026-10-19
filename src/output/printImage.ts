import sharp from "sharp";
import type { Adjustments, Shop } from "../model.js";

export const PAGE_WIDTH_MM = 69;
export const PAGE_HEIGHT_MM = 94;
export const BLEED_MM = 3;

// Previews sit in this folder next to the images they show.
export const PREVIEW_DIR = 'previews-700';

export interface PixelSize {
    width: number;
    height: number;
}

export function pageSizeInPixels(dpi: number): PixelSize {
    return {
        width: Math.round(PAGE_WIDTH_MM / 25.4 * dpi),
        height: Math.round(PAGE_HEIGHT_MM / 25.4 * dpi)
    };
}

// printerstudio.de flags images narrower than MPC's 2.72 × 3.70 inches as low resolution, and the page is 0.1 mm narrower.
export function printSizeInPixels(shop: Shop, dpi: number): PixelSize {
    return shop === 'printerstudio' ? { width: Math.round(2.72 * dpi), height: Math.round(3.7 * dpi) } : pageSizeInPixels(dpi);
}

export async function toPrintJpeg(input: string | Buffer, outputPath: string, { width, height }: PixelSize, iccProfile: string, adjustments: Adjustments) {
    const { brightness, contrast } = adjustments;

    // The profile is not attached: it would add ~1.8 MB per image, the PDF carries it once as output intent.
    // Brightness, then contrast around middle grey: the same formula as the CSS filters of the app's preview.
    await sharp(input)
        .flatten({ background: '#ffffff' })
        .resize(width, height, { fit: 'cover' })
        .linear(brightness * contrast, 128 * (1 - contrast))
        .withIccProfile(iccProfile, { attach: false })
        .jpeg({ quality: 95 })
        .toFile(outputPath);
}

export async function createBlankPrintJpeg(outputPath: string, size: PixelSize, iccProfile: string) {
    const white = await sharp({ create: { ...size, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await toPrintJpeg(white, outputPath, size, iccProfile, { brightness: 1, contrast: 1 });
}

// Small sRGB copy for screens. CMYK images are converted with the default CMYK profile, so the colours are approximate.
export async function writePreview(image: string, outputPath: string) {
    await sharp(image)
        .resize(700)
        .toColourspace('srgb')
        .jpeg({ quality: 80 })
        .toFile(outputPath);
}
