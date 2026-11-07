import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { DEFAULT_HOME_PRINT, DefaultOrder, DefaultProfile, type HomePrint, NO_ADJUSTMENTS, type Order, type OrderCard } from "../model.js";
import { cardsDir } from "../config/paths.js";
import { buildPacks } from "../pipeline/packs.js";
import { homePrintHtml, writeHomePdf } from "./homePrint.js";

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-pdf-'));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

function card(id: string, quantity: number): OrderCard {
    const png = `https://cards.scryfall.io/png/front/a/b/${id}.png`;
    const image_uris = { small: png, normal: png, large: png, png, art_crop: png, border_crop: png };
    const printing = { id, name: id, set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Land', layout: 'normal', image_uris };
    return { id, deck: 'deck', board: 'mainboard', name: id, quantity, isToken: false, excluded: false, printing };
}

function order(cards: OrderCard[], homePrint: Partial<HomePrint> = {}): Order {
    return {
        ...DefaultOrder, name: 'home', shop: 'home', adjustments: NO_ADJUSTMENTS, cards,
        profile: { ...DefaultProfile, outputDirectory: dir }, homePrint: { ...DEFAULT_HOME_PRINT, ...homePrint }
    };
}

function points(pdf: PDFDocument) {
    const { width, height } = pdf.getPage(0).getSize();
    return [width, height].map(value => Math.round(value * 100) / 100);
}

async function processImages(target: Order) {
    await fs.mkdir(cardsDir(target), { recursive: true });
    for (const file of new Set(buildPacks(target).packs.flat().map(slot => slot.front))) {
        await sharp({ create: { width: 69, height: 94, channels: 3, background: '#c03030' } }).jpeg().toFile(path.join(cardsDir(target), file));
    }
}

test('writeHomePdf puts the fronts on A4 pages, all pages as many times as the copies ask for, with each image embedded once', async () => {
    const target = order([card('island', 10)], { copies: 2 });
    await processImages(target);
    const file = path.join(dir, 'home.pdf');

    await writeHomePdf(target, file);

    const pdf = await PDFDocument.load(await fs.readFile(file));
    assert.equal(pdf.getPageCount(), 4);
    assert.deepEqual(points(pdf), [595.28, 841.89]);
    const images = pdf.context.enumerateIndirectObjects()
        .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    assert.equal(images.length, 1);
});

test('writeHomePdf turns the page for a landscape grid', async () => {
    const target = order([card('island', 8)], { landscape: true, columns: 4, rows: 2 });
    await processImages(target);
    const file = path.join(dir, 'home.pdf');

    await writeHomePdf(target, file);

    const pdf = await PDFDocument.load(await fs.readFile(file));
    assert.equal(pdf.getPageCount(), 1);
    assert.deepEqual(points(pdf), [841.89, 595.28]);
});

test('writeHomePdf asks for the images to be processed first', async () => {
    await assert.rejects(writeHomePdf(order([card('island', 2)]), path.join(dir, 'home.pdf')), /Process the images first/);
});

test('homePrintHtml lays the pages out in millimetres like the PDF, with the processed fronts, all pages as many times as the copies ask for', async () => {
    const target = order([card('island', 10)], { copies: 2, guides: 'cut-lines' });
    await processImages(target);

    const html = await homePrintHtml(target);

    assert.match(html, /@page \{ size: 210mm 297mm; margin: 0; \}/);
    assert.equal(html.match(/<section>/g)?.length, 4);
    assert.equal(html.match(/<img /g)?.length, 20, 'the blank slots stay empty');
    const src = pathToFileURL(path.join(cardsDir(target), buildPacks(target).packs[0]![0]!.front)).href;
    assert.ok(html.includes(`<div style="left:10.5mm;top:16.5mm;width:63mm;height:88mm"><img src="${src}" style="left:-3mm;top:-3mm;width:69mm;height:94mm"></div>`));
    assert.equal(html.match(/<line /g)?.length, 4 * 8);
});

test('homePrintHtml asks for the images to be processed first', async () => {
    await assert.rejects(homePrintHtml(order([card('island', 2)])), /Process the images first/);
});
