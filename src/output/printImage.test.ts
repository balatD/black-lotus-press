import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createBlankPrintJpeg, pageSizeInPixels, printSizeInPixels, toPrintJpeg, writePreview } from "./printImage.js";
import { NO_ADJUSTMENTS } from "../model.js";

test('page size is 69x94 mm with 3 mm bleed', () => {
    assert.deepEqual(pageSizeInPixels(300), { width: 815, height: 1110 });
    assert.deepEqual(pageSizeInPixels(600), { width: 1630, height: 2220 });
});

test('print images for printerstudio have the 2.72 × 3.70 inches of MPC, a pixel wider than the page at 300 dpi', () => {
    assert.deepEqual(printSizeInPixels('printerstudio', 300), { width: 816, height: 1110 });
    assert.deepEqual(printSizeInPixels('printerstudio', 800), { width: 2176, height: 2960 });
    assert.deepEqual(printSizeInPixels('meinspiel', 300), pageSizeInPixels(300));
    assert.deepEqual(printSizeInPixels('notmpc', 300), pageSizeInPixels(300));
});

test('toPrintJpeg writes an exact-size CMYK JPEG without an embedded profile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const input = await sharp({ create: { width: 817, height: 1112, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
    const output = path.join(dir, 'card.jpg');

    await toPrintJpeg(input, output, pageSizeInPixels(300), 'cmyk', NO_ADJUSTMENTS);

    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 815);
    assert.equal(metadata.height, 1110);
    assert.equal(metadata.space, 'cmyk');
    assert.equal(metadata.icc, undefined);
});

async function printedGrey(value: string, adjustments: { brightness: number, contrast: number }) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const grey = await sharp({ create: { width: 815, height: 1110, channels: 3, background: value } }).png().toBuffer();
    const output = path.join(dir, 'grey.jpg');
    await toPrintJpeg(grey, output, pageSizeInPixels(300), 'cmyk', adjustments);

    const rgb = await sharp(output).toColourspace('srgb').png().toBuffer();
    return (await sharp(rgb).stats()).channels[0]!.mean;
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

    await createBlankPrintJpeg(output, pageSizeInPixels(300), 'cmyk');

    const stats = await sharp(output).stats();
    assert.equal(stats.channels.length, 4);
    assert.ok(stats.channels.every(channel => channel.max <= 1), 'all CMYK channels should be ~0 for white');
});

test('writePreview writes a small sRGB copy of a CMYK print image', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-image-'));
    const print = path.join(dir, 'card.jpg');
    await createBlankPrintJpeg(print, pageSizeInPixels(300), 'cmyk');
    const preview = path.join(dir, 'preview.jpg');

    await writePreview(print, preview);

    const metadata = await sharp(preview).metadata();
    assert.equal(metadata.width, 700);
    assert.equal(metadata.space, 'srgb');
});
