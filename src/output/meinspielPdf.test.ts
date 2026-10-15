import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { buildPdfs, writePackPdf, writePacks } from "./meinspielPdf.js";
import { CARDS_PER_PACK } from "../pipeline/packs.js";
import { cardsDir, setDataRoot } from "../config/paths.js";
import { DefaultOrder, type Order, type ProgressEvent } from "../model.js";
import { createBlankPrintJpeg, toPrintJpeg } from "./printImage.js";

test('writePackPdf writes 69x94 mm pages with trim box and output intent, without the XMP metadata meinspiel.de fails on', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meinspiel-pdf-'));
    const back = path.join(dir, 'back.jpg');
    await createBlankPrintJpeg(back, 300, 'cmyk');
    const output = path.join(dir, 'backs.pdf');

    await writePackPdf(Array(CARDS_PER_PACK).fill(back), new Uint8Array([1, 2, 3]), output);

    const bytes = await fs.readFile(output);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(doc.getPageCount(), CARDS_PER_PACK);

    const page = doc.getPage(0);
    const media = page.getMediaBox();
    assert.ok(Math.abs(media.width - 195.59) < 0.01 && Math.abs(media.height - 266.46) < 0.01);
    const trim = page.getTrimBox();
    assert.ok(Math.abs(trim.x - 8.504) < 0.01 && Math.abs(trim.width - 178.58) < 0.01 && Math.abs(trim.height - 249.45) < 0.01);

    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    const intent = intents.lookup(0, PDFDict);
    assert.equal(intent.get(PDFName.of('S')), PDFName.of('GTS_PDFX'));
    assert.ok(intent.get(PDFName.of('DestOutputProfile')) instanceof PDFRef);

    assert.equal(doc.catalog.get(PDFName.of('Metadata')), undefined);

    const images = doc.context.enumerateIndirectObjects()
        .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    assert.equal(images.length, 1, 'identical pages should share one embedded image');
});

test('writePacks writes a fronts and a backs PDF per pack', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meinspiel-pdf-'));
    const red = Buffer.from(`<svg width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`);
    await toPrintJpeg(red, path.join(dir, 'front.jpg'), 300, 'cmyk', { brightness: 1, contrast: 1 });
    await createBlankPrintJpeg(path.join(dir, 'back.jpg'), 300, 'cmyk');
    const pack = Array(CARDS_PER_PACK).fill({ front: 'front.jpg', back: 'back.jpg' });

    const events: ProgressEvent[] = [];
    const files = await writePacks([pack, pack], dir, path.join(dir, 'meinspiel'), new Uint8Array([1]), event => events.push(event));

    assert.deepEqual(files.map(file => path.basename(file.fronts)), ['pack-01-fronts.pdf', 'pack-02-fronts.pdf']);
    assert.deepEqual(files.map(file => path.basename(file.backs)), ['pack-01-backs.pdf', 'pack-02-backs.pdf']);
    assert.ok(files.every(file => file.bytes > 0));
    assert.deepEqual(events, [
        { type: 'progress', done: 0, total: 4, message: 'Writing the fronts of pack 1' },
        { type: 'progress', done: 1, total: 4, message: 'Writing the backs of pack 1' },
        { type: 'progress', done: 2, total: 4, message: 'Writing the fronts of pack 2' },
        { type: 'progress', done: 3, total: 4, message: 'Writing the backs of pack 2' }
    ]);
});

async function orderWithOneCard(): Promise<Order> {
    setDataRoot(await fs.mkdtemp(path.join(os.tmpdir(), 'meinspiel-pdf-')));
    const png = 'https://cards.scryfall.io/png/front/a/b/island.png';
    const printing = {
        id: 'island', name: 'Island', set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Land', layout: 'normal',
        image_uris: { small: png, normal: png, large: png, png, art_crop: png, border_crop: png }
    };
    return { ...DefaultOrder, name: 'test', cardBack: 'drive1', cards: [{ id: 'island', deck: 'deck', board: 'mainboard', name: 'Island', quantity: 3, isToken: false, excluded: false, printing }] };
}

test('buildPdfs refuses to build when card images are missing', async () => {
    const order = await orderWithOneCard();

    await assert.rejects(buildPdfs(order, new Uint8Array([1])), /3 card image\(s\) are not processed yet/);
    setDataRoot(process.cwd());
});

test('buildPdfs writes one fronts and one backs PDF per pack from the processed images', async () => {
    const order = await orderWithOneCard();
    await fs.mkdir(cardsDir(order), { recursive: true });
    for (const file of ['scryfall-island-front-b110-c100.jpg', 'cardback-drive1-b110-c100.jpg', 'blank.jpg']) {
        await createBlankPrintJpeg(path.join(cardsDir(order), file), 150, 'cmyk');
    }

    const { packs, droppedTokens } = await buildPdfs(order, new Uint8Array([1]));

    assert.deepEqual(packs.map(pack => path.basename(pack.fronts)), ['pack-01-fronts.pdf']);
    assert.equal((await PDFDocument.load(await fs.readFile(packs[0]!.backs))).getPageCount(), CARDS_PER_PACK);
    assert.deepEqual(droppedTokens, []);
    setDataRoot(process.cwd());
});
