import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DefaultProfile } from "../model.js";
import { customImagePath, setDataRoot } from "../config/paths.js";
import { importCustomImage, prepareCustomImage } from "./customImage.js";

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-image-'));
    setDataRoot(dir);
});

afterEach(() => setDataRoot(process.cwd()));

async function image(width: number, height: number, file: string) {
    const target = path.join(dir, file);
    await sharp({ create: { width, height, channels: 3, background: '#3366aa' } }).png().toFile(target);
    return target;
}

test('importCustomImage stores the image by content in the data root', async () => {
    const first = await importCustomImage(await image(630, 880, 'a.png'));
    const second = await importCustomImage(await image(630, 880, 'b.png'));

    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{16}\.png$/);
    assert.ok((await fs.stat(customImagePath(first))).isFile());
});

test('importCustomImage rejects landscape images', async () => {
    await assert.rejects(importCustomImage(await image(880, 630, 'wide.png')), /Landscape/);
});

test('prepareCustomImage keeps images that already include the bleed', async () => {
    const prepared = await prepareCustomImage(await fs.readFile(await image(816, 1110, 'mpc.png')), DefaultProfile.postProcessing);

    const { width, height } = await sharp(prepared).metadata();
    assert.deepEqual([width, height], [816, 1110]);
});

test('prepareCustomImage adds a 3 mm bleed around card-sized images', async () => {
    const prepared = await prepareCustomImage(await fs.readFile(await image(630, 880, 'card.png')), DefaultProfile.postProcessing);

    const { width, height } = await sharp(prepared).metadata();
    assert.deepEqual([width, height], [690, 940]);
});
