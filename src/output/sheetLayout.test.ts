import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_SIZES, DEFAULT_HOME_PRINT, type HomePrint } from "../model.js";
import { backSlots, cutPaths, fittingGrids, guidePath, sheetLayout, withFittingGrid } from "./sheetLayout.js";

test('sheetLayout centres a grid of 3 × 3 cards of 63 × 88 mm on A4', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, guides: 'none' });

    assert.deepEqual([layout.width, layout.height], [210, 297]);
    assert.equal(layout.slots.length, 9);
    assert.deepEqual(layout.slots[0], { x: 10.5, y: 16.5, width: 63, height: 88 });
    assert.deepEqual(layout.slots[8], { x: 136.5, y: 192.5, width: 63, height: 88 });
    assert.deepEqual(layout.guides, []);
});

test('sheetLayout grows the slots by the bleed and runs cut lines across the page along both edges of every card', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, bleed: 1, gap: 2, guides: 'cut-lines' });

    assert.deepEqual(layout.slots[0], { x: 5.5, y: 11.5, width: 65, height: 90 });
    const vertical = layout.guides.filter(line => line.x1 === line.x2);
    assert.deepEqual(vertical.map(line => line.x1), [6.5, 69.5, 73.5, 136.5, 140.5, 203.5]);
    assert.ok(vertical.every(line => line.y1 === 0 && line.y2 === 297));
    assert.equal(layout.guides.length - vertical.length, 6);
});

test('sheetLayout puts crop marks in the margins at both ends of every cut, where cards touching share one', () => {
    const layout = sheetLayout(DEFAULT_HOME_PRINT);

    assert.equal(layout.guides.length, 16);
    assert.deepEqual(layout.guides[0], { x1: 10.5, y1: 11.5, x2: 10.5, y2: 15.5 });
    const insideGrid = (x: number, y: number) => x > 10.5 && x < 199.5 && y > 16.5 && y < 280.5;
    assert.ok(layout.guides.every(line => !insideGrid(line.x1, line.y1) && !insideGrid(line.x2, line.y2)));
});

test('sheetLayout makes the crop marks as long and as far from the cards as asked for', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, markLength: 6, markOffset: 0 });

    assert.deepEqual(layout.guides[0], { x1: 10.5, y1: 10.5, x2: 10.5, y2: 16.5 });
});

test('sheetLayout runs cut lines outside the cards through the margins and the space between the cards, never over a card', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, bleed: 1, gap: 2, guides: 'cut-lines-outside' });

    const at = (x: number) => layout.guides.filter(line => line.x1 === x && line.x2 === x).map(line => [line.y1, line.y2]);
    assert.deepEqual(at(6.5), [[0, 11.5], [101.5, 103.5], [193.5, 195.5], [285.5, 297]]);
    assert.equal(layout.guides.length, 2 * 6 * 4);
    const onCard = (x: number, y: number) => layout.slots.some(slot => x > slot.x && x < slot.x + slot.width && y > slot.y && y < slot.y + slot.height);
    assert.ok(layout.guides.every(line => !onCard((line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2)));

    // Cards that touch leave room for the lines in the margins only.
    assert.deepEqual(sheetLayout({ ...DEFAULT_HOME_PRINT, guides: 'cut-lines-outside' }).guides[0], { x1: 10.5, y1: 0, x2: 10.5, y2: 16.5 });
});

test('sheetLayout runs edge lines from the edges of the paper to the cuts of the outer cards', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, bleed: 1, gap: 2, guides: 'edges' });

    const at = (x: number) => layout.guides.filter(line => line.x1 === x && line.x2 === x).map(line => [line.y1, line.y2]);
    assert.deepEqual(at(6.5), [[0, 12.5], [284.5, 297]]);
    assert.equal(layout.guides.length, 2 * 6 * 2);
});

test('sheetLayout draws card guides at the corners of every card as long as asked for, or all around it, square or round', () => {
    const corners = sheetLayout({ ...DEFAULT_HOME_PRINT, cardGuides: 'corners', cardGuidePlacement: 'center' });
    assert.equal(corners.cardGuides.length, 9);
    assert.equal(corners.cardGuides[0], 'M10.5 22.5V16.5H16.5M67.5 16.5H73.5V22.5M73.5 98.5V104.5H67.5M16.5 104.5H10.5V98.5');

    const round = sheetLayout({ ...DEFAULT_HOME_PRINT, cardGuides: 'full', cardGuideCorners: 'round', cardGuidePlacement: 'center' });
    assert.equal(round.cardGuides[0],
        'M13 16.5H71A2.5 2.5 0 0 1 73.5 19V102A2.5 2.5 0 0 1 71 104.5H13A2.5 2.5 0 0 1 10.5 102V19A2.5 2.5 0 0 1 13 16.5Z');
});

test('sheetLayout puts card guides of 2 pt in the bleed outside the cut, or on the card inside it', () => {
    const full = { ...DEFAULT_HOME_PRINT, cardGuides: 'full' as const, guideWidth: 2 };

    assert.match(sheetLayout(full).cardGuides[0]!, /^M10\.147 16\.147H73\.853/);
    assert.match(sheetLayout({ ...full, cardGuidePlacement: 'inside' }).cardGuides[0]!, /^M10\.853 16\.853H73\.147/);
});

test('guidePath draws the page guides and the card guides of the slots with a card as one path', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, guides: 'cut-lines', cardGuides: 'corners', cardGuidePlacement: 'center' });

    const path = guidePath(layout, [true, ...Array(8).fill(false)]);

    assert.ok(path.startsWith('M10.5 0L10.5 297'));
    assert.ok(path.endsWith(layout.cardGuides[0]!));
    assert.equal(path.match(/M/g)?.length, 8 + 4);
});

test('sheetLayout gives the guides their colour, their width in millimetres and their dashes', () => {
    assert.deepEqual(sheetLayout(DEFAULT_HOME_PRINT).stroke, { color: '#ec008c', width: 0.5 * 25.4 / 72, dash: [], cap: 'butt' });
    assert.deepEqual(sheetLayout({ ...DEFAULT_HOME_PRINT, guideColor: 'black', guideWidth: 1, guideStyle: 'dotted' }).stroke,
        { color: '#000000', width: 25.4 / 72, dash: [0, 1.5], cap: 'round' });
});

test('backSlots put every back behind its front: turned on the long edge of a portrait page the columns swap sides, on the short edge the rows', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, offsetX: 2 });
    const back = (settings: Partial<HomePrint>) => backSlots(layout, { ...DEFAULT_HOME_PRINT, ...settings })[0];

    assert.deepEqual(layout.slots[0], { x: 12.5, y: 16.5, width: 63, height: 88 });
    assert.deepEqual(back({}), { x: 134.5, y: 16.5, width: 63, height: 88 });
    assert.deepEqual(back({ flip: 'short' }), { x: 12.5, y: 192.5, width: 63, height: 88 });
    assert.deepEqual(back({ landscape: true }), { x: 12.5, y: 192.5, width: 63, height: 88 }, 'the long edge of a landscape page is at the top');
    assert.deepEqual(back({ backOffsetX: 1, backOffsetY: -0.5 }), { x: 135.5, y: 16, width: 63, height: 88 });
});

test('sheetLayout moves the cards and their guides by the offset', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, offsetX: -2, offsetY: 4 });

    assert.deepEqual(layout.slots[0], { x: 8.5, y: 20.5, width: 63, height: 88 });
    assert.deepEqual(layout.guides[0], { x1: 8.5, y1: 15.5, x2: 8.5, y2: 19.5 });
});

test('fittingGrids lists the grids that fit the paper inside its margins, most cards first', () => {
    const a4 = fittingGrids({ paper: 'a4', gap: 0, bleed: 0 });
    assert.deepEqual(a4[0], { landscape: false, columns: 3, rows: 3 });
    assert.deepEqual(a4[1], { landscape: true, columns: 4, rows: 2 });
    assert.deepEqual(a4.at(-1), { landscape: true, columns: 1, rows: 1 });

    // 3 rows with bleed are 270 mm, more than the 269.4 mm Letter has inside its margins.
    assert.deepEqual(fittingGrids({ paper: 'letter', gap: 0, bleed: 1 })[0], { landscape: true, columns: 4, rows: 2 });
});

test('withFittingGrid keeps a grid that fits and takes the one with the most cards otherwise', () => {
    assert.deepEqual(withFittingGrid({ ...DEFAULT_HOME_PRINT, columns: 2, rows: 2 }), { ...DEFAULT_HOME_PRINT, columns: 2, rows: 2 });
    assert.deepEqual(withFittingGrid({ ...DEFAULT_HOME_PRINT, paper: 'letter', bleed: 1 }), { ...DEFAULT_HOME_PRINT, paper: 'letter', bleed: 1, landscape: true, columns: 4, rows: 2 });
});

test('withFittingGrid keeps the offset small enough for the cards to stay on the paper', () => {
    const moved = withFittingGrid({ ...DEFAULT_HOME_PRINT, offsetX: -20, offsetY: 6 });
    assert.deepEqual([moved.offsetX, moved.offsetY], [-10.5, 6]);

    // 3 × 3 on Letter leaves 7.7 mm above and below the cards.
    const letter = withFittingGrid({ ...DEFAULT_HOME_PRINT, offsetY: 12, paper: 'letter' });
    assert.equal(Math.round(letter.offsetY! * 100) / 100, 7.7);
});

test('sheetLayout and fittingGrids lay out Yu-Gi-Oh cards at their 59 × 86 mm, 3 × 3 on A4', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, guides: 'none' }, CARD_SIZES.yugioh);

    assert.deepEqual(layout.slots[0], { x: 16.5, y: 19.5, width: 59, height: 86 });
    assert.deepEqual(fittingGrids({ paper: 'a4', gap: 0, bleed: 3 }, CARD_SIZES.yugioh)[0], { landscape: false, columns: 3, rows: 3 });
    assert.deepEqual(withFittingGrid({ ...DEFAULT_HOME_PRINT, offsetY: 30 }, CARD_SIZES.yugioh).offsetY, 19.5);
});

const silhouette = { ...DEFAULT_HOME_PRINT, cutter: 'silhouette' as const };

test('sheetLayout draws the three registration marks of Silhouette Studio, their lines centred on the inset', () => {
    const { marks } = sheetLayout({ ...silhouette, landscape: true, columns: 4, rows: 2 });

    assert.deepEqual(marks, [
        { x: 9.5, y: 9.5, width: 6, height: 6 },
        { x: 277, y: 9.5, width: 10.5, height: 1 },
        { x: 286.5, y: 9.5, width: 1, height: 10.5 },
        { x: 9.5, y: 199.5, width: 10.5, height: 1 },
        { x: 9.5, y: 190, width: 1, height: 10.5 }
    ]);
    assert.deepEqual(sheetLayout(DEFAULT_HOME_PRINT).marks, []);
});

test('fittingGrids keeps the cards inside the marks of a cutter and off the squares at their corners', () => {
    assert.deepEqual(fittingGrids({ paper: 'a4', gap: 0, bleed: 0 })[0], { landscape: false, columns: 3, rows: 3 });
    // 3 columns are 189 mm, more than the 186 mm inside the marks of A4.
    assert.deepEqual(fittingGrids({ ...silhouette, paper: 'a4', gap: 0, bleed: 0 })[0], { landscape: true, columns: 4, rows: 2 });
    // Marks of 20 mm reach 31.5 mm into the page, into the corners of 4 × 2 cards.
    assert.deepEqual(withFittingGrid({ ...silhouette, regLength: 20, landscape: true, columns: 4, rows: 2 }).columns * withFittingGrid({ ...silhouette, regLength: 20, landscape: true, columns: 4, rows: 2 }).rows, 6);
});

test('sheetLayout leaves out the page guides and the printer offset with a cutter, which finds the cards by the marks', () => {
    const layout = sheetLayout({ ...silhouette, landscape: true, columns: 4, rows: 2, offsetX: 3, guides: 'cut-lines' });

    assert.deepEqual(layout.guides, []);
    assert.deepEqual(layout.slots[0], { x: 22.5, y: 17, width: 63, height: 88 });
});

test('cutPaths cut every card along its edge, inside the bleed, with round or square corners', () => {
    const layout = sheetLayout({ ...DEFAULT_HOME_PRINT, bleed: 1 });

    assert.match(cutPaths(layout, { bleed: 1, cutCorners: 'round' })[0]!, /^M11 14\.5H69A2\.5 2\.5 0 0 1 71\.5 17V100/);
    assert.equal(cutPaths(layout, { bleed: 1, cutCorners: 'square' })[0], 'M8.5 14.5H71.5V102.5H8.5V14.5Z');
});
