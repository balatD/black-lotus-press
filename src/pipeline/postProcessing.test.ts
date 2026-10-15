import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { DefaultProfile, type PostProcessingProfile, type ScryfallCard } from "../model.js";
import { postProcessImage } from "./postProcessing.js";

const printing: ScryfallCard = {
    id: 'a', name: 'Card', set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Instant', layout: 'normal'
};

// Brightest pixel in the strip of the copyright line, on a plain dark scan.
async function copyrightLineMaximum(config: PostProcessingProfile) {
    const scan = await sharp({ create: { width: 745, height: 1040, channels: 3, background: '#202020' } }).png().toBuffer();
    const result = await postProcessImage(scan, printing, 'front', config);
    const { height } = await sharp(result).metadata();
    const strip = await sharp(result).extract({ left: 0, top: Math.round(height * 0.9), width: 745, height: Math.round(height * 0.08) }).greyscale().raw().toBuffer();
    return Math.max(...strip);
}

test('postProcessImage writes the own text over the blurred copyright line', async () => {
    const blur = await copyrightLineMaximum({ ...DefaultProfile.postProcessing, copyrightBehavior: 'blur' });
    const custom = await copyrightLineMaximum({ ...DefaultProfile.postProcessing, copyrightBehavior: 'custom', copyrightText: 'Proxy & <friends>' });

    assert.ok(blur < 60, `the plain scan stays dark, got ${blur}`);
    assert.ok(custom > 200, `the text is printed in white, got ${custom}`);
});

test('postProcessImage mirrors the art into the bleed of borderless cards instead of stretching the edge', async () => {
    // A left-to-right gradient: stretching the edge makes the outermost columns identical, mirroring does not.
    const gradient = Buffer.from(`<svg width="745" height="1040"><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient><rect width="745" height="1040" fill="url(#g)"/></svg>`);
    const scan = await sharp(gradient).png().toBuffer();
    const result = await postProcessImage(scan, { ...printing, border_color: 'borderless' }, 'front', DefaultProfile.postProcessing);
    const { data, info } = await sharp(result).greyscale().raw().toBuffer({ resolveWithObject: true });
    const row = Math.round(info.height / 2) * info.width;

    assert.notEqual(data[row], data[row + 12], 'the bleed shows mirrored art, not a stretched edge');
});
