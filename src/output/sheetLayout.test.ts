import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_SIZES, DEFAULT_HOME_PRINT } from "../model.js";
import { fittingGrids, sheetLayout, withFittingGrid } from "./sheetLayout.js";

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
