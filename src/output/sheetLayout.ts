import type { HomePrint, Paper } from "../model.js";

export const PAPERS: Record<Paper, { name: string, width: number, height: number }> = {
    a4: { name: 'A4', width: 210, height: 297 },
    letter: { name: 'Letter', width: 215.9, height: 279.4 }
};

const CARD_WIDTH_MM = 63;
const CARD_HEIGHT_MM = 88;
// The bleed the print images have around the card, as in printImage.ts.
export const IMAGE_BLEED_MM = 3;
// Home printers leave about this much of the paper's edge blank.
const MARGIN_MM = 5;
const MARK_OFFSET_MM = 1;
const MARK_LENGTH_MM = 4;
// Magenta shows on black, white and coloured card borders alike, where grey vanishes on dark ones.
export const GUIDE_COLOR = '#ec008c';

export interface Box { x: number, y: number, width: number, height: number }
export interface Line { x1: number, y1: number, x2: number, y2: number }

// Millimetres from the top left corner of the page; the slots go row by row.
export interface SheetLayout {
    width: number;
    height: number;
    slots: Box[];
    guides: Line[];
}

type Grid = Pick<HomePrint, 'paper' | 'landscape' | 'columns' | 'rows' | 'gap' | 'bleed'>;

function pageSize({ paper, landscape }: Pick<HomePrint, 'paper' | 'landscape'>) {
    const { width, height } = PAPERS[paper];
    return landscape ? { width: height, height: width } : { width, height };
}

function gridSize({ columns, rows, gap, bleed }: Grid) {
    return {
        width: columns * (CARD_WIDTH_MM + 2 * bleed) + (columns - 1) * gap,
        height: rows * (CARD_HEIGHT_MM + 2 * bleed) + (rows - 1) * gap
    };
}

function fits(grid: Grid) {
    const page = pageSize(grid);
    const size = gridSize(grid);
    return size.width <= page.width - 2 * MARGIN_MM && size.height <= page.height - 2 * MARGIN_MM;
}

export function sheetLayout(settings: Grid & Pick<HomePrint, 'guides' | 'offsetX' | 'offsetY'>): SheetLayout {
    const { columns, rows, gap, bleed } = settings;
    const page = pageSize(settings);
    const grid = gridSize(settings);
    const left = (page.width - grid.width) / 2 + (settings.offsetX ?? 0);
    const top = (page.height - grid.height) / 2 + (settings.offsetY ?? 0);
    const width = CARD_WIDTH_MM + 2 * bleed;
    const height = CARD_HEIGHT_MM + 2 * bleed;

    const slots: Box[] = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            slots.push({ x: left + column * (width + gap), y: top + row * (height + gap), width, height });
        }
    }

    // Both edges of every card; cards that touch share theirs.
    const unique = (values: number[]) => [...new Set(values.map(value => Math.round(value * 1000) / 1000))];
    const cutsX = unique(slots.slice(0, columns).flatMap(slot => [slot.x + bleed, slot.x + bleed + CARD_WIDTH_MM]));
    const cutsY = unique(slots.filter((_, index) => index % columns === 0).flatMap(slot => [slot.y + bleed, slot.y + bleed + CARD_HEIGHT_MM]));

    const right = left + grid.width;
    const bottom = top + grid.height;
    const guides: Line[] = settings.guides === 'cut-lines' ? [
        ...cutsX.map(x => ({ x1: x, y1: 0, x2: x, y2: page.height })),
        ...cutsY.map(y => ({ x1: 0, y1: y, x2: page.width, y2: y }))
    ] : settings.guides === 'crop-marks' ? [
        ...cutsX.flatMap(x => [
            { x1: x, y1: top - MARK_OFFSET_MM - MARK_LENGTH_MM, x2: x, y2: top - MARK_OFFSET_MM },
            { x1: x, y1: bottom + MARK_OFFSET_MM, x2: x, y2: bottom + MARK_OFFSET_MM + MARK_LENGTH_MM }
        ]),
        ...cutsY.flatMap(y => [
            { x1: left - MARK_OFFSET_MM - MARK_LENGTH_MM, y1: y, x2: left - MARK_OFFSET_MM, y2: y },
            { x1: right + MARK_OFFSET_MM, y1: y, x2: right + MARK_OFFSET_MM + MARK_LENGTH_MM, y2: y }
        ])
    ] : [];

    return { ...page, slots, guides };
}

// Portrait before landscape where both hold as many cards. A single card always fits, as the bleed is at most 3 mm.
export function fittingGrids(settings: Pick<HomePrint, 'paper' | 'gap' | 'bleed'>): Pick<HomePrint, 'landscape' | 'columns' | 'rows'>[] {
    const grids: Pick<HomePrint, 'landscape' | 'columns' | 'rows'>[] = [];
    for (const landscape of [false, true]) {
        for (let columns = 1; fits({ ...settings, landscape, columns, rows: 1 }); columns++) {
            for (let rows = 1; fits({ ...settings, landscape, columns, rows }); rows++) grids.push({ landscape, columns, rows });
        }
    }
    return grids.sort((a, b) => b.columns * b.rows - a.columns * a.rows);
}

// Also keeps the offset small enough for the cards to stay on the paper.
export function withFittingGrid(settings: HomePrint): HomePrint {
    const fitting = fits(settings) ? settings : { ...settings, ...fittingGrids(settings)[0]! };
    if (fitting.offsetX === undefined && fitting.offsetY === undefined) return fitting;
    const page = pageSize(fitting);
    const grid = gridSize(fitting);
    const within = (offset: number | undefined, room: number) => Math.min(room, Math.max(-room, offset ?? 0));
    return { ...fitting, offsetX: within(fitting.offsetX, (page.width - grid.width) / 2), offsetY: within(fitting.offsetY, (page.height - grid.height) / 2) };
}
