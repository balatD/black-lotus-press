import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clip, endPath, PDFDocument, type PDFImage, popGraphicsState, pushGraphicsState, rectangle, rgb } from "pdf-lib";
import { CARD_SIZES, DEFAULT_HOME_PRINT, type Order } from "../model.js";
import { buildPacks, type Slot } from "../pipeline/packs.js";
import { cardsDir } from "../config/paths.js";
import { exists } from "../utils/fs.js";
import { GUIDE_COLOR, IMAGE_BLEED_MM, sheetLayout } from "./sheetLayout.js";

const POINTS_PER_MM = 72 / 25.4;
const GUIDE_WIDTH_PT = 0.5;

async function processedPages(order: Order): Promise<Slot[][]> {
    const pages = buildPacks(order).packs;
    let missing = 0;
    for (const file of new Set(pages.flat().filter(slot => slot.cardId !== undefined).map(slot => slot.front))) {
        if (!await exists(path.join(cardsDir(order), file))) missing++;
    }
    if (missing > 0) throw new Error(`Process the images first: ${missing} of the card images are not processed yet.`);
    return pages;
}

// The fronts of the cards; blank slots stay empty paper.
export async function writeHomePdf(order: Order, outputPath: string) {
    const settings = order.homePrint ?? DEFAULT_HOME_PRINT;
    const pages = await processedPages(order);
    const dir = cardsDir(order);

    const layout = sheetLayout(settings, CARD_SIZES[order.tcg]);
    const pt = (mm: number) => mm * POINTS_PER_MM;
    // PDF measures from the bottom left corner.
    const bottom = (y: number, height = 0) => pt(layout.height - y - height);
    // The print images are larger than the slots by the bleed they have and the slots do not.
    const overhang = IMAGE_BLEED_MM - settings.bleed;
    const [red, green, blue] = [1, 3, 5].map(at => parseInt(GUIDE_COLOR.slice(at, at + 2), 16) / 255) as [number, number, number];
    const guideColor = rgb(red, green, blue);

    const doc = await PDFDocument.create();
    doc.setTitle(order.name);
    doc.setCreator('Black Lotus Press');
    const images = new Map<string, PDFImage>();
    const embed = async (file: string) => {
        let image = images.get(file);
        if (!image) {
            image = await doc.embedJpg(await fs.readFile(path.join(dir, file)));
            images.set(file, image);
        }
        return image;
    };

    for (let copy = 0; copy < settings.copies; copy++) {
        for (const slots of pages) {
            const page = doc.addPage([pt(layout.width), pt(layout.height)]);
            for (const [index, slot] of slots.entries()) {
                if (slot.cardId === undefined) continue;
                const box = layout.slots[index]!;
                page.pushOperators(pushGraphicsState(), rectangle(pt(box.x), bottom(box.y, box.height), pt(box.width), pt(box.height)), clip(), endPath());
                page.drawImage(await embed(slot.front), {
                    x: pt(box.x - overhang), y: bottom(box.y - overhang, box.height + 2 * overhang),
                    width: pt(box.width + 2 * overhang), height: pt(box.height + 2 * overhang)
                });
                page.pushOperators(popGraphicsState());
            }
            for (const line of layout.guides) {
                page.drawLine({ start: { x: pt(line.x1), y: bottom(line.y1) }, end: { x: pt(line.x2), y: bottom(line.y2) }, thickness: GUIDE_WIDTH_PT, color: guideColor });
            }
        }
    }

    await fs.writeFile(outputPath, await doc.save());
}

// The pages of the PDF as a web page for the system's print dialog, laid out in millimetres like the PDF.
export async function homePrintHtml(order: Order): Promise<string> {
    const settings = order.homePrint ?? DEFAULT_HOME_PRINT;
    const pages = await processedPages(order);
    const layout = sheetLayout(settings, CARD_SIZES[order.tcg]);
    const overhang = IMAGE_BLEED_MM - settings.bleed;
    const mm = (value: number) => `${value}mm`;
    const guides = layout.guides.map(line => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"/>`).join('');

    const page = (slots: Slot[]) => `<section>${slots.map((slot, index) => {
        if (slot.cardId === undefined) return '';
        const box = layout.slots[index]!;
        const src = pathToFileURL(path.join(cardsDir(order), slot.front)).href;
        return `<div style="left:${mm(box.x)};top:${mm(box.y)};width:${mm(box.width)};height:${mm(box.height)}">`
            + `<img src="${src}" style="left:${mm(-overhang)};top:${mm(-overhang)};width:${mm(box.width + 2 * overhang)};height:${mm(box.height + 2 * overhang)}"></div>`;
    }).join('')}<svg viewBox="0 0 ${layout.width} ${layout.height}">${guides}</svg></section>`;

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${order.name.replaceAll('&', '&amp;')}</title>
<style>
@page { size: ${layout.width}mm ${layout.height}mm; margin: 0; }
html, body { margin: 0; }
section { position: relative; width: ${layout.width}mm; height: ${layout.height}mm; overflow: hidden; }
section + section { break-before: page; }
section > div { position: absolute; overflow: hidden; }
img { position: absolute; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; }
line { stroke: ${GUIDE_COLOR}; stroke-width: ${GUIDE_WIDTH_PT}pt; vector-effect: non-scaling-stroke; }
</style>
</head>
<body>${Array.from({ length: settings.copies }, () => pages.map(page).join('')).join('')}</body>
</html>
`;
}
