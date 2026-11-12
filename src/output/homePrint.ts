import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clip, endPath, LineCapStyle, PDFDocument, type PDFImage, popGraphicsState, pushGraphicsState, rectangle, rgb } from "pdf-lib";
import { cardSize, DEFAULT_HOME_PRINT, type Order } from "../model.js";
import { buildPacks, type Slot } from "../pipeline/packs.js";
import { cardsDir } from "../config/paths.js";
import { exists } from "../utils/fs.js";
import { backSlots, CORNER_RADIUS_MM, cutPaths, guidePath, IMAGE_BLEED_MM, sheetLayout } from "./sheetLayout.js";

const POINTS_PER_MM = 72 / 25.4;

async function processedPages(order: Order): Promise<Slot[][]> {
    const pages = buildPacks(order).packs;
    const both = order.homePrint?.sides === 'both';
    let missing = 0;
    for (const file of new Set(pages.flat().filter(slot => slot.cardId !== undefined).flatMap(slot => both ? [slot.front, slot.back] : [slot.front]))) {
        if (!await exists(path.join(cardsDir(order), file))) missing++;
    }
    if (missing > 0) throw new Error(`Process the images first: ${missing} of the card images are not processed yet.`);
    return pages;
}

// The fronts of the cards, each page followed by the page of their backs when both sides print; blank slots stay empty paper.
export async function writeHomePdf(order: Order, outputPath: string) {
    const settings = order.homePrint ?? DEFAULT_HOME_PRINT;
    const pages = await processedPages(order);
    const dir = cardsDir(order);

    const layout = sheetLayout(settings, cardSize(order));
    const pt = (mm: number) => mm * POINTS_PER_MM;
    // PDF measures from the bottom left corner.
    const bottom = (y: number, height = 0) => pt(layout.height - y - height);
    // The print images are larger than the slots by the bleed they have and the slots do not.
    const overhang = IMAGE_BLEED_MM - settings.bleed;
    const { stroke } = layout;
    const [red, green, blue] = [1, 3, 5].map(at => parseInt(stroke.color.slice(at, at + 2), 16) / 255) as [number, number, number];
    // The path is in millimetres from the top left corner, so it is scaled to points and turned upside down, its widths and dashes along with it.
    const guide = {
        x: 0, y: pt(layout.height), scale: POINTS_PER_MM, borderColor: rgb(red, green, blue), borderWidth: stroke.width, borderDashArray: stroke.dash,
        borderLineCap: stroke.cap === 'round' ? LineCapStyle.Round : LineCapStyle.Butt
    };

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

    const backs = backSlots(layout, settings);
    const addPage = async (slots: Slot[], boxes: typeof backs, side: 'front' | 'back') => {
        const page = doc.addPage([pt(layout.width), pt(layout.height)]);
        for (const [index, slot] of slots.entries()) {
            if (slot.cardId === undefined) continue;
            const box = boxes[index]!;
            page.pushOperators(pushGraphicsState(), rectangle(pt(box.x), bottom(box.y, box.height), pt(box.width), pt(box.height)), clip(), endPath());
            page.drawImage(await embed(slot[side]), {
                x: pt(box.x - overhang), y: bottom(box.y - overhang, box.height + 2 * overhang),
                width: pt(box.width + 2 * overhang), height: pt(box.height + 2 * overhang)
            });
            page.pushOperators(popGraphicsState());
        }
        return page;
    };

    for (let copy = 0; copy < settings.copies; copy++) {
        for (const slots of pages) {
            const page = await addPage(slots, layout.slots, 'front');
            const guides = guidePath(layout, slots.map(slot => slot.cardId !== undefined));
            if (guides) page.drawSvgPath(guides, guide);
            for (const mark of layout.marks) {
                page.drawRectangle({ x: pt(mark.x), y: bottom(mark.y, mark.height), width: pt(mark.width), height: pt(mark.height), color: rgb(0, 0, 0) });
            }
            // The cuts follow the fronts, so the backs have no guides.
            if (settings.sides === 'both') await addPage(slots, backs, 'back');
        }
    }

    await fs.writeFile(outputPath, await doc.save());
}

// The pages of the PDF as a web page for the system's print dialog, laid out in millimetres like the PDF.
export async function homePrintHtml(order: Order): Promise<string> {
    const settings = order.homePrint ?? DEFAULT_HOME_PRINT;
    const pages = await processedPages(order);
    const layout = sheetLayout(settings, cardSize(order));
    const overhang = IMAGE_BLEED_MM - settings.bleed;
    const mm = (value: number) => `${value}mm`;
    const { stroke } = layout;
    const strokeAttributes = `fill="none" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-dasharray="${stroke.dash.join(' ') || 'none'}" stroke-linecap="${stroke.cap}"`;

    const backs = backSlots(layout, settings);
    const cards = (slots: Slot[], boxes: typeof backs, side: 'front' | 'back') => slots.map((slot, index) => {
        if (slot.cardId === undefined) return '';
        const box = boxes[index]!;
        const src = pathToFileURL(path.join(cardsDir(order), slot[side])).href;
        return `<div style="left:${mm(box.x)};top:${mm(box.y)};width:${mm(box.width)};height:${mm(box.height)}">`
            + `<img src="${src}" style="left:${mm(-overhang)};top:${mm(-overhang)};width:${mm(box.width + 2 * overhang)};height:${mm(box.height + 2 * overhang)}"></div>`;
    }).join('');
    const page = (slots: Slot[]) => `<section>${cards(slots, layout.slots, 'front')}`
        + `<svg viewBox="0 0 ${layout.width} ${layout.height}" ${strokeAttributes}><path d="${guidePath(layout, slots.map(slot => slot.cardId !== undefined))}"/>`
        + `${layout.marks.map(mark => `<rect x="${mark.x}" y="${mark.y}" width="${mark.width}" height="${mark.height}" fill="#000" stroke="none"/>`).join('')}</svg></section>`
        + (settings.sides === 'both' ? `<section>${cards(slots, backs, 'back')}</section>` : '');

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
</style>
</head>
<body>${Array.from({ length: settings.copies }, () => pages.map(page).join('')).join('')}</body>
</html>
`;
}

// The cut lines of the cards of every page, for the cutter's software to cut along the marks printed with them. The cards are in the
// middle of the page, so Center to Page in Silhouette Studio puts the lines where they are printed.
export function cutFile(order: Order, format: 'svg' | 'dxf'): string {
    const settings = order.homePrint ?? DEFAULT_HOME_PRINT;
    const layout = sheetLayout(settings, cardSize(order));
    const paths = cutPaths(layout, settings);
    if (format === 'svg') {
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}mm" height="${layout.height}mm" viewBox="0 0 ${layout.width} ${layout.height}">
${paths.map(d => `<path d="${d}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`).join('\n')}
</svg>
`;
    }
    return dxf(layout.height, layout.slots.map(slot => ({
        x: slot.x + settings.bleed, y: slot.y + settings.bleed, width: slot.width - 2 * settings.bleed, height: slot.height - 2 * settings.bleed
    })), settings.cutCorners === 'round' ? CORNER_RADIUS_MM : 0);
}

// Lines and arcs, which every version of Silhouette Studio opens, in millimetres with the y axis upwards.
function dxf(pageHeight: number, boxes: { x: number, y: number, width: number, height: number }[], r: number) {
    const n = (value: number) => String(Math.round(value * 1000) / 1000);
    const entities: string[] = [];
    const line = (x1: number, y1: number, x2: number, y2: number) => entities.push('0', 'LINE', '8', 'CUT', '10', n(x1), '20', n(pageHeight - y1), '11', n(x2), '21', n(pageHeight - y2));
    // Counter-clockwise from the start angle, as DXF draws arcs, with the y axis turned upwards.
    const arc = (cx: number, cy: number, start: number, end: number) => entities.push('0', 'ARC', '8', 'CUT', '10', n(cx), '20', n(pageHeight - cy), '40', n(r), '50', n(start), '51', n(end));
    for (const { x, y, width, height } of boxes) {
        const [x0, y0, x1, y1] = [x, y, x + width, y + height];
        line(x0 + r, y0, x1 - r, y0);
        line(x1, y0 + r, x1, y1 - r);
        line(x1 - r, y1, x0 + r, y1);
        line(x0, y1 - r, x0, y0 + r);
        if (r > 0) {
            arc(x1 - r, y0 + r, 0, 90);
            arc(x0 + r, y0 + r, 90, 180);
            arc(x0 + r, y1 - r, 180, 270);
            arc(x1 - r, y1 - r, 270, 360);
        }
    }
    return ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
}
