import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createBlankPrintJpeg, pageSizeInPixels, printSizeInPixels, toPrintJpeg, toPrintPng, writePreview } from "./printImage.js";
import { CARD_SIZES, NO_ADJUSTMENTS } from "../model.js";

test('page size is 69x94 mm with 3 mm bleed', () => {
    assert.deepEqual(pageSizeInPixels(300), { width: 815, height: 1110 });
    assert.deepEqual(pageSizeInPixels(600), { width: 1630, height: 2220 });
});

test('the page of a Yu-Gi-Oh card is its 59 × 86 mm with 3 mm bleed', () => {
    assert.deepEqual(pageSizeInPixels(300, CARD_SIZES.yugioh), { width: 768, height: 1087 });
    assert.deepEqual(printSizeInPixels('home', 300, CARD_SIZES.yugioh), { width: 768, height: 1087 });
});

test('print images for printerstudio have the 2.72 × 3.70 inches of MPC, a pixel wider than the page at 300 dpi', () => {
    assert.deepEqual(printSizeInPixels('printerstudio', 300), { width: 816, height: 1110 });
    assert.deepEqual(printSizeInPixels('printerstudio', 800), { width: 2176, height: 2960 });
    assert.deepEqual(printSizeInPixels('meinspiel', 300), pageSizeInPixels(300));
});

test('toPrintJpeg writes an exact-size sRGB JPEG without an embedded profile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const input = await sharp({ create: { width: 817, height: 1112, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
    const output = path.join(dir, 'card.jpg');

    await toPrintJpeg(input, output, pageSizeInPixels(300), NO_ADJUSTMENTS);

    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 815);
    assert.equal(metadata.height, 1110);
    assert.equal(metadata.space, 'srgb');
    assert.equal(metadata.icc, undefined);
});

test('toPrintPng writes the same card as toPrintJpeg as an exact-size 8-bit sRGB PNG', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const input = await sharp({ create: { width: 817, height: 1112, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
    const adjustments = { brightness: 1.1, contrast: 1.2 };
    await toPrintJpeg(input, path.join(dir, 'card.jpg'), pageSizeInPixels(300), adjustments);

    await toPrintPng(input, path.join(dir, 'card.png'), pageSizeInPixels(300), adjustments);

    const metadata = await sharp(path.join(dir, 'card.png')).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height, metadata.space, metadata.channels, metadata.depth], ['png', 815, 1110, 'srgb', 3, 'uchar']);
    const means = async (file: string) => (await sharp(path.join(dir, file)).stats()).channels.map(channel => channel.mean);
    const [png, jpeg] = [await means('card.png'), await means('card.jpg')];
    png.forEach((mean, index) => assert.ok(Math.abs(mean - jpeg[index]!) < 2, `channel ${index}: PNG ${mean}, JPEG ${jpeg[index]}`));
});

async function printedGrey(value: string, adjustments: { brightness: number, contrast: number }) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const grey = await sharp({ create: { width: 815, height: 1110, channels: 3, background: value } }).png().toBuffer();
    const output = path.join(dir, 'grey.jpg');
    await toPrintJpeg(grey, output, pageSizeInPixels(300), adjustments);

    return (await sharp(output).stats()).channels[0]!.mean;
}

test('toPrintJpeg applies the brightness', async () => {
    const ratio = await printedGrey('#808080', { brightness: 1.1, contrast: 1 }) / await printedGrey('#808080', NO_ADJUSTMENTS);

    assert.ok(ratio > 1.05 && ratio < 1.2, `expected ~10% brighter, got ${ratio}`);
});

test('toPrintJpeg applies the contrast around the middle grey', async () => {
    const darker = await printedGrey('#505050', { brightness: 1, contrast: 1.4 }) - await printedGrey('#505050', NO_ADJUSTMENTS);
    const lighter = await printedGrey('#b0b0b0', { brightness: 1, contrast: 1.4 }) - await printedGrey('#b0b0b0', NO_ADJUSTMENTS);

    assert.ok(darker < -10, `dark grey should get darker, changed by ${darker}`);
    assert.ok(lighter > 10, `light grey should get lighter, changed by ${lighter}`);
});

test('createBlankPrintJpeg writes a white page', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const output = path.join(dir, 'blank.jpg');

    await createBlankPrintJpeg(output, pageSizeInPixels(300));

    const stats = await sharp(output).stats();
    assert.equal(stats.channels.length, 3);
    assert.ok(stats.channels.every(channel => channel.min >= 254), 'all channels should be white');
});

// meinspiel.de orders processed while it printed PDFs keep their CMYK print images until they are made again.
test('writePreview writes a small sRGB copy of a CMYK print image', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const print = path.join(dir, 'card.jpg');
    await sharp({ create: { ...pageSizeInPixels(300), channels: 3, background: '#ffffff' } }).toColourspace('cmyk').jpeg().toFile(print);
    const preview = path.join(dir, 'preview.jpg');

    await writePreview(print, preview);

    const metadata = await sharp(preview).metadata();
    assert.equal(metadata.width, 700);
    assert.equal(metadata.space, 'srgb');
});

test('toPrintPng darkens the outer band of the card on request, leaving its middle and white borders as they are', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const size = pageSizeInPixels(300);
    const pixel = async (file: string, x: number, y: number) => {
        const { data } = await sharp(file).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
        return data[0]!;
    };
    const grey = await sharp({ create: { ...size, channels: 3, background: { r: 60, g: 60, b: 60 } } }).png().toBuffer();
    const white = await sharp({ create: { ...size, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const darkened = path.join(dir, 'grey.png');
    const whiteOut = path.join(dir, 'white.png');

    await toPrintPng(grey, darkened, size, { ...NO_ADJUSTMENTS, edges: 1 });
    await toPrintPng(white, whiteOut, size, { ...NO_ADJUSTMENTS, edges: 1 });

    assert.equal(await pixel(darkened, 10, 10), 0, '60 is below the black point of 64');
    assert.equal(await pixel(darkened, Math.round(size.width / 2), Math.round(size.height / 2)), 60);
    assert.equal(await pixel(whiteOut, 10, 10), 255);
});
