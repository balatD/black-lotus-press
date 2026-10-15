import sharp from "sharp";
import type { Adjustments } from "../model.js";

export const PAGE_WIDTH_MM = 69;
export const PAGE_HEIGHT_MM = 94;
export const BLEED_MM = 3;

// Previews sit in this folder next to the images they show.
export const PREVIEW_DIR = 'previews-700';

export function pageSizeInPixels(dpi: number) {
    return {
        width: Math.round(PAGE_WIDTH_MM / 25.4 * dpi),
        height: Math.round(PAGE_HEIGHT_MM / 25.4 * dpi)
    };
}

export async function toPrintJpeg(input: string | Buffer, outputPath: string, dpi: number, iccProfile: string, adjustments: Adjustments) {
    const { width, height } = pageSizeInPixels(dpi);
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

export async function createBlankPrintJpeg(outputPath: string, dpi: number, iccProfile: string) {
    const { width, height } = pageSizeInPixels(dpi);
    const white = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await toPrintJpeg(white, outputPath, dpi, iccProfile, { brightness: 1, contrast: 1 });
}

// Small sRGB copy for screens. CMYK images are converted with the default CMYK profile, so the colours are approximate.
export async function writePreview(image: string, outputPath: string) {
    await sharp(image)
        .resize(700)
        .toColourspace('srgb')
        .jpeg({ quality: 80 })
        .toFile(outputPath);
}
