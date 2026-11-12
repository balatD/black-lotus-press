import { CARD_SIZES, type GuideColor, type HomePrint, type Paper } from "../model.js";

export const PAPERS: Record<Paper, { name: string, width: number, height: number }> = {
    a4: { name: 'A4', width: 210, height: 297 },
    letter: { name: 'Letter', width: 215.9, height: 279.4 }
};

type CardSize = { width: number, height: number };
// The bleed the print images have around the card, as in printImage.ts.
export const IMAGE_BLEED_MM = 3;
// Home printers leave about this much of the paper's edge blank.
const MARGIN_MM = 5;
const POINTS_PER_MM = 72 / 25.4;
// Magenta shows on black, white and coloured card borders alike, where grey vanishes on dark ones.
export const GUIDE_COLORS: Record<GuideColor, { name: string, value: string }> = {
    magenta: { name: 'Magenta', value: '#ec008c' },
    cyan: { name: 'Cyan', value: '#00aeef' },
    black: { name: 'Black', value: '#000000' },
    grey: { name: 'Grey', value: '#808080' }
};
// Dots are dashes of no length with round ends.
const DASHES: Record<HomePrint['guideStyle'], { dash: number[], cap: 'butt' | 'round' }> = {
    solid: { dash: [], cap: 'butt' },
    dashed: { dash: [2, 1], cap: 'butt' },
    dotted: { dash: [0, 1.5], cap: 'round' }
};
// The corners of Magic cards, as the MTG Wiki gives them; the other cards get the same.
export const CORNER_RADIUS_MM = 2.5;
// The filled square of Silhouette Studio's marks, and room kept free around the marks.
const REG_SQUARE_MM = 5;
const REG_PADDING_MM = 1.5;

export interface Box { x: number, y: number, width: number, height: number }
export interface Line { x1: number, y1: number, x2: number, y2: number }
export interface Stroke { color: string, width: number, dash: number[], cap: 'butt' | 'round' }

// Millimetres from the top left corner of the page; the slots go row by row, and so do the card guides, as SVG paths.
export interface SheetLayout {
    width: number;
    height: number;
    slots: Box[];
    guides: Line[];
    cardGuides: string[];
    stroke: Stroke;
    // The registration marks of a cutter, filled black.
    marks: Box[];
}

type Cutter = Partial<Pick<HomePrint, 'cutter' | 'regInset' | 'regLength' | 'regThickness'>>;
type Grid = Pick<HomePrint, 'paper' | 'landscape' | 'columns' | 'rows' | 'gap' | 'bleed'> & Cutter;

function pageSize({ paper, landscape }: Pick<HomePrint, 'paper' | 'landscape'>) {
    const { width, height } = PAPERS[paper];
    return landscape ? { width: height, height: width } : { width, height };
}

function gridSize({ columns, rows, gap, bleed }: Grid, card: CardSize) {
    return {
        width: columns * (card.width + 2 * bleed) + (columns - 1) * gap,
        height: rows * (card.height + 2 * bleed) + (rows - 1) * gap
    };
}

// Silhouette Studio cuts only inside its marks and wants nothing printed in the squares at their corners. Its inset is
// measured to the middle of the marks' lines, as silhouette-card-maker draws them.
function cutterArea(settings: Cutter, page: CardSize) {
    if (settings.cutter !== 'silhouette') return undefined;
    const inset = settings.regInset ?? 10;
    const length = settings.regLength ?? 10;
    const thickness = settings.regThickness ?? 1;
    const reach = inset + length + REG_PADDING_MM;
    const corner = (x: number, y: number): Box => ({ x, y, width: reach, height: reach });
    return {
        margin: inset + thickness / 2 + REG_PADDING_MM,
        corners: [corner(0, 0), corner(page.width - reach, 0), corner(0, page.height - reach)],
        marks: [
            { x: inset - thickness / 2, y: inset - thickness / 2, width: REG_SQUARE_MM + thickness, height: REG_SQUARE_MM + thickness },
            { x: page.width - inset - length, y: inset - thickness / 2, width: length + thickness / 2, height: thickness },
            { x: page.width - inset - thickness / 2, y: inset - thickness / 2, width: thickness, height: length + thickness / 2 },
            { x: inset - thickness / 2, y: page.height - inset - thickness / 2, width: length + thickness / 2, height: thickness },
            { x: inset - thickness / 2, y: page.height - inset - length, width: thickness, height: length + thickness / 2 }
        ]
    };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function fits(grid: Grid, card: CardSize) {
    const page = pageSize(grid);
    const size = gridSize(grid, card);
    const cutter = cutterArea(grid, page);
    const margin = cutter?.margin ?? MARGIN_MM;
    if (size.width > page.width - 2 * margin || size.height > page.height - 2 * margin) return false;
    const box = { x: (page.width - size.width) / 2, y: (page.height - size.height) / 2, ...size };
    return !cutter?.corners.some(corner => overlaps(corner, box));
}

type Guides = Pick<HomePrint, 'guides' | 'cardGuides' | 'cardGuideCorners' | 'cardGuideLength' | 'cardGuidePlacement'
    | 'guideColor' | 'guideWidth' | 'guideStyle' | 'markLength' | 'markOffset' | 'offsetX' | 'offsetY'>;

// The cut line of every slot's card, all around, as an SVG path in millimetres.
export function cutPaths(layout: SheetLayout, settings: Pick<HomePrint, 'bleed' | 'cutCorners'>): string[] {
    const radius = settings.cutCorners === 'round' ? CORNER_RADIUS_MM : 0;
    return layout.slots.map(slot => cardGuide(
        { x: slot.x + settings.bleed, y: slot.y + settings.bleed, width: slot.width - 2 * settings.bleed, height: slot.height - 2 * settings.bleed }, radius));
}

const points = (...values: number[]) => values.map(value => Math.round(value * 1000) / 1000).join(' ');

// Clockwise from the top left corner, all around the box or only at its corners as far as the length; `r` is 0 for square corners.
function cardGuide({ x, y, width, height }: Box, r: number, length?: number): string {
    const [x0, y0, x1, y1] = [x, y, x + width, y + height];
    const arc = (toX: number, toY: number) => r > 0 ? `A${points(r, r)} 0 0 1 ${points(toX, toY)}` : '';
    if (length === undefined) {
        return `M${points(x0 + r, y0)}H${points(x1 - r)}${arc(x1, y0 + r)}V${points(y1 - r)}${arc(x1 - r, y1)}`
            + `H${points(x0 + r)}${arc(x0, y1 - r)}V${points(y0 + r)}${arc(x0 + r, y0)}Z`;
    }
    const l = Math.min(Math.max(length, r), width / 2, height / 2);
    return `M${points(x0, y0 + l)}V${points(y0 + r)}${arc(x0 + r, y0)}H${points(x0 + l)}`
        + `M${points(x1 - l, y0)}H${points(x1 - r)}${arc(x1, y0 + r)}V${points(y0 + l)}`
        + `M${points(x1, y1 - l)}V${points(y1 - r)}${arc(x1 - r, y1)}H${points(x1 - l)}`
        + `M${points(x0 + l, y1)}H${points(x0 + r)}${arc(x0, y1 - r)}V${points(y1 - l)}`;
}

// The guides of a page as one SVG path in millimetres, with card guides only where a card is.
export function guidePath(layout: SheetLayout, filled: boolean[]): string {
    return [
        ...layout.guides.map(line => `M${points(line.x1, line.y1)}L${points(line.x2, line.y2)}`),
        ...layout.cardGuides.filter((_, index) => filled[index])
    ].join('');
}

// The stretches from 0 to the end that the spans leave free; the spans are in order and do not overlap.
function free(spans: [number, number][], end: number): [number, number][] {
    const edges = [0, ...spans.flat(), end];
    return Array.from({ length: edges.length / 2 }, (_, index) => [edges[2 * index]!, edges[2 * index + 1]!] as [number, number])
        .filter(([from, to]) => to - from > 0.001);
}

export function sheetLayout(settings: Grid & Guides, card: CardSize = CARD_SIZES.magic): SheetLayout {
    const { columns, rows, gap, bleed, markLength, markOffset } = settings;
    const page = pageSize(settings);
    const grid = gridSize(settings, card);
    // The cutter finds the cards by the marks printed with them, so the cards stay in the middle, where the cut file has them.
    const cutter = cutterArea(settings, page);
    const left = (page.width - grid.width) / 2 + (cutter ? 0 : settings.offsetX ?? 0);
    const top = (page.height - grid.height) / 2 + (cutter ? 0 : settings.offsetY ?? 0);
    const width = card.width + 2 * bleed;
    const height = card.height + 2 * bleed;

    const slots: Box[] = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            slots.push({ x: left + column * (width + gap), y: top + row * (height + gap), width, height });
        }
    }

    // Both edges of every card; cards that touch share theirs.
    const unique = (values: number[]) => [...new Set(values.map(value => Math.round(value * 1000) / 1000))];
    const cutsX = unique(slots.slice(0, columns).flatMap(slot => [slot.x + bleed, slot.x + bleed + card.width]));
    const cutsY = unique(slots.filter((_, index) => index % columns === 0).flatMap(slot => [slot.y + bleed, slot.y + bleed + card.height]));

    const right = left + grid.width;
    const bottom = top + grid.height;
    // Edge lines run from the paper's edge to the cut of the outer cards. Cut lines outside the cards leave out where the slots are,
    // so they run through the margins and the space between the cards.
    const along = (spans: [number, number][], end: number): [number, number][] =>
        settings.guides === 'cut-lines' ? [[0, end]]
            : settings.guides === 'edges' ? [[0, spans[0]![0] + bleed], [spans.at(-1)![1] - bleed, end]]
                : free(spans, end);
    const rowSpans = slots.filter((_, index) => index % columns === 0).map(slot => [slot.y, slot.y + slot.height] as [number, number]);
    const columnSpans = slots.slice(0, columns).map(slot => [slot.x, slot.x + slot.width] as [number, number]);
    // Page guides near the marks could mislead the cutter's sensor.
    const guides: Line[] = settings.guides === 'none' || cutter ? [] : settings.guides === 'crop-marks' ? [
        ...cutsX.flatMap(x => [
            { x1: x, y1: top - markOffset - markLength, x2: x, y2: top - markOffset },
            { x1: x, y1: bottom + markOffset, x2: x, y2: bottom + markOffset + markLength }
        ]),
        ...cutsY.flatMap(y => [
            { x1: left - markOffset - markLength, y1: y, x2: left - markOffset, y2: y },
            { x1: right + markOffset, y1: y, x2: right + markOffset + markLength, y2: y }
        ])
    ] : [
        ...cutsX.flatMap(x => along(rowSpans, page.height).map(([y1, y2]) => ({ x1: x, y1, x2: x, y2 }))),
        ...cutsY.flatMap(y => along(columnSpans, page.width).map(([x1, x2]) => ({ x1, y1: y, x2, y2: y })))
    ];
    const stroke = { color: GUIDE_COLORS[settings.guideColor].value, width: settings.guideWidth / POINTS_PER_MM, ...DASHES[settings.guideStyle] };

    // Outside, the card guides lie in the bleed next to the cut; inside, on the card next to it.
    const shift = { outside: stroke.width / 2, center: 0, inside: -stroke.width / 2 }[settings.cardGuidePlacement];
    const radius = settings.cardGuideCorners === 'round' ? CORNER_RADIUS_MM + shift : 0;
    const cardGuides = settings.cardGuides === 'none' ? [] : slots.map(slot => cardGuide(
        { x: slot.x + bleed - shift, y: slot.y + bleed - shift, width: card.width + 2 * shift, height: card.height + 2 * shift },
        radius, settings.cardGuides === 'corners' ? settings.cardGuideLength : undefined
    ));

    return { ...page, slots, guides, cardGuides, stroke, marks: cutter?.marks ?? [] };
}

// The slots of the page of backs, where each lands behind its front once the paper is turned over: turned on the long edge of a
// portrait page, or the short edge of a landscape one, the columns swap sides, otherwise the rows. The back offset comes on top.
export function backSlots(layout: SheetLayout, settings: Pick<HomePrint, 'landscape' | 'flip' | 'backOffsetX' | 'backOffsetY'>): Box[] {
    const swapColumns = (settings.flip === 'long') !== settings.landscape;
    return layout.slots.map(slot => ({
        ...slot,
        x: (swapColumns ? layout.width - slot.x - slot.width : slot.x) + settings.backOffsetX,
        y: (swapColumns ? slot.y : layout.height - slot.y - slot.height) + settings.backOffsetY
    }));
}

// Portrait before landscape where both hold as many cards. A single card fits unless the marks of a cutter take the room of a large one.
export function fittingGrids(settings: Pick<HomePrint, 'paper' | 'gap' | 'bleed'> & Cutter, card: CardSize = CARD_SIZES.magic): Pick<HomePrint, 'landscape' | 'columns' | 'rows'>[] {
    const grids: Pick<HomePrint, 'landscape' | 'columns' | 'rows'>[] = [];
    for (const landscape of [false, true]) {
        for (let columns = 1; fits({ ...settings, landscape, columns, rows: 1 }, card); columns++) {
            for (let rows = 1; fits({ ...settings, landscape, columns, rows }, card); rows++) grids.push({ landscape, columns, rows });
        }
    }
    return grids.sort((a, b) => b.columns * b.rows - a.columns * a.rows);
}

// Also keeps the offset small enough for the cards to stay on the paper.
export function withFittingGrid(settings: HomePrint, card: CardSize = CARD_SIZES.magic): HomePrint {
    const fitting = fits(settings, card) ? settings : { ...settings, ...(fittingGrids(settings, card)[0] ?? { landscape: false, columns: 1, rows: 1 }) };
    if (fitting.offsetX === undefined && fitting.offsetY === undefined) return fitting;
    const page = pageSize(fitting);
    const grid = gridSize(fitting, card);
    const within = (offset: number | undefined, room: number) => Math.min(room, Math.max(-room, offset ?? 0));
    return { ...fitting, offsetX: within(fitting.offsetX, (page.width - grid.width) / 2), offsetY: within(fitting.offsetY, (page.height - grid.height) / 2) };
}
