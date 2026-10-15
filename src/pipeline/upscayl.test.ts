import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { upscaleImage } from "./upscayl.js";
import { DefaultProfile } from "../model.js";

const missingBinary = { enabled: true, binaryFile: '/nonexistent/upscayl-bin', model: 'upscayl-standard-4x' };

async function postProcessedCard() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'upscayl-'));
    const file = path.join(dir, 'card.png');
    await sharp({ create: { width: 815, height: 1110, channels: 3, background: '#808080' } }).png().toFile(file);
    return file;
}

test('upscaleImage skips Upscayl when the card already has the target resolution', async () => {
    await upscaleImage(await postProcessedCard(), { ...DefaultProfile.postProcessing, dpi: 300 }, missingBinary);
});

test('upscaleImage runs Upscayl when the target resolution is higher', async () => {
    await assert.rejects(upscaleImage(await postProcessedCard(), { ...DefaultProfile.postProcessing, dpi: 600 }, missingBinary));
});
