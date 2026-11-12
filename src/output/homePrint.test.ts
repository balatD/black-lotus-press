import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { DEFAULT_HOME_PRINT, DefaultOrder, DefaultProfile, type HomePrint, NO_ADJUSTMENTS, type Order, type OrderCard } from "../model.js";
import { cardsDir } from "../config/paths.js";
import { buildPacks } from "../pipeline/packs.js";
import { cutFile, homePrintHtml, writeHomePdf } from "./homePrint.js";

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

async function pageOperators(file: string) {
    const pdf = await PDFDocument.load(await fs.readFile(file));
    const contents = pdf.getPage(0).node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
    return streams.map(stream => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString('latin1')).join('\n');
}

// In points: the guides are drawn in millimetres, scaled to points.
function lineWidth(operators: string) {
    const [, scale] = operators.match(/([\d.]+) 0 0 -[\d.]+ 0 [\d.]+ cm/) ?? [];
    const [, width] = operators.match(/([\d.]+) w/) ?? [];
    return Math.round(Number(width) * Number(scale) * 1000) / 1000;
}

async function processImages(target: Order) {
    await fs.mkdir(cardsDir(target), { recursive: true });
    for (const file of new Set(buildPacks(target).packs.flat().flatMap(slot => [slot.front, slot.back]))) {
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

test('writeHomePdf and homePrintHtml draw the guides in magenta, 0.5 pt wide, so they show on dark cards too', async () => {
    const target = order([card('island', 9)], { guides: 'cut-lines' });
    await processImages(target);
    const file = path.join(dir, 'home.pdf');

    await writeHomePdf(target, file);

    const operators = await pageOperators(file);
    const [, red, blue] = operators.match(/([\d.]+) 0 ([\d.]+) RG/) ?? [];
    assert.deepEqual([Math.round(Number(red) * 255), Math.round(Number(blue) * 255)], [0xec, 0x8c]);
    assert.equal(lineWidth(operators), 0.5);
    assert.match(await homePrintHtml(target), /<svg [^>]*stroke="#ec008c" stroke-width="0\.176\d*" stroke-dasharray="none" stroke-linecap="butt">/);
});

test('writeHomePdf and homePrintHtml draw the guides in the colour, width and style the settings ask for', async () => {
    const target = order([card('island', 9)], { guides: 'cut-lines', guideColor: 'black', guideWidth: 2, guideStyle: 'dashed' });
    await processImages(target);
    const file = path.join(dir, 'home.pdf');

    await writeHomePdf(target, file);

    const operators = await pageOperators(file);
    assert.match(operators, /\b0 0 0 RG\b/);
    assert.equal(lineWidth(operators), 2);
    // The dashes are millimetres, as the path is drawn scaled to points.
    assert.match(operators, /\[2 1\] 0 d/);
    assert.match(await homePrintHtml(target), /<svg [^>]*stroke="#000000" stroke-width="0\.705\d*" stroke-dasharray="2 1" stroke-linecap="butt">/);

    const dotted = { ...target, homePrint: { ...target.homePrint!, guideStyle: 'dotted' as const } };
    await writeHomePdf(dotted, file);
    assert.match(await pageOperators(file), /\b1 J\b/);
    assert.match(await homePrintHtml(dotted), /stroke-dasharray="0 1\.5" stroke-linecap="round"/);
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
    assert.equal(html.match(/<path d="[^"]*"/g)?.join('').match(/M/g)?.length, 4 * 8);
});

test('homePrintHtml draws card guides only around the cards, not around the blank slots of the last page', async () => {
    const target = order([card('island', 10)], { guides: 'none', cardGuides: 'corners' });
    await processImages(target);

    const paths = (await homePrintHtml(target)).match(/<path d="[^"]*"/g)!;

    assert.deepEqual(paths.map(path => path.match(/M/g)?.length), [9 * 4, 4]);
});

test('writeHomePdf and homePrintHtml follow every page of fronts with the page of their backs, without guides, when both sides print', async () => {
    const target = order([card('island', 10)], { sides: 'both', guides: 'cut-lines' });
    await processImages(target);
    const file = path.join(dir, 'home.pdf');

    await writeHomePdf(target, file);
    const html = await homePrintHtml(target);

    assert.equal((await PDFDocument.load(await fs.readFile(file))).getPageCount(), 4);
    const sections = html.split('<section>').slice(1);
    assert.equal(sections.length, 4);
    const back = pathToFileURL(path.join(cardsDir(target), buildPacks(target).packs[0]![0]!.back)).href;
    // The first card is at the left of the fronts and so at the right of the backs.
    assert.ok(sections[1]!.startsWith(`<div style="left:136.5mm;top:16.5mm;width:63mm;height:88mm"><img src="${back}"`));
    assert.ok(!sections[1]!.includes('<path'));
});

test('homePrintHtml lays Yu-Gi-Oh cards out at their 59 × 86 mm', async () => {
    const target = { ...order([card('island', 9)]), tcg: 'yugioh' as const };
    await processImages(target);

    const html = await homePrintHtml(target);

    assert.ok(html.includes('<div style="left:16.5mm;top:19.5mm;width:59mm;height:86mm">'));
});

test('homePrintHtml asks for the images to be processed first', async () => {
    await assert.rejects(homePrintHtml(order([card('island', 2)])), /Process the images first/);
});

test('homePrintHtml prints the registration marks of a cutter on every page of fronts, and cutFile has the cut lines of every slot', async () => {
    const target = order([card('island', 9)], { cutter: 'silhouette', landscape: true, columns: 4, rows: 2 });
    await processImages(target);

    const html = await homePrintHtml(target);
    const svg = cutFile(target, 'svg');
    const dxf = cutFile(target, 'dxf');

    assert.equal(html.match(/<rect /g)?.length, 2 * 5);
    assert.match(svg, /<svg [^>]*width="297mm" height="210mm" viewBox="0 0 297 210">/);
    assert.equal(svg.match(/<path /g)?.length, 8);
    assert.equal(dxf.match(/\nLINE\n/g)?.length, 8 * 4);
    assert.equal(dxf.match(/\nARC\n/g)?.length, 8 * 4);
    assert.match(dxf, /\$INSUNITS\n70\n4\n/);
});
