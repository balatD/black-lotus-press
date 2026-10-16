// Builds the splash-screen card printer into app/renderer/src/components/press/ (art.ts, iso.css).
// --preview <file.html> also writes a standalone page for screenshots; --audit checks the geometry.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import * as k from "../anatomy/iso-kit.mjs";
import * as G from "../anatomy/lathe.mjs";
import * as A from "../anatomy/audit.mjs";
import { tubePieces, tubeSvg } from "../anatomy/tube.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "app/renderer/src/components/press");

const W = 760;
const H = 460;

// World units are millimetres: x along the card path, y across it, z up.
const CARD = { L: 88, W: 63, T: 0.6, R: 2.6 };
const ZC = 20;
const FACE_Z = ZC + CARD.T;
const RIBBON_Z = FACE_Z + 0.1;
const LIFT = 3;

const BASE = { x: -204, y: -66, w: 408, d: 134, r: 9 };
const PLATE_H = 8;
const FOOT_H = 5;
const WALL = { x: -90, y: -54, w: 180, d: 6, r: 1 };
const WALL_H = 64;
const WALL_IN = WALL.y + WALL.d;
const FRAME = { x: -90, y: 42, w: 180, d: 5, r: 1 };
const FRAME_H = 22;
const FRAME_OUT = FRAME.y + FRAME.d;

const ROLL_HALF = 35;
const ROLL_R = 6;
const LOWER_Z = ZC - ROLL_R;
const UPPER_Z = FACE_Z + ROLL_R;
const PAIRS = [-64, 64];
const SHAFT_R = 2;
const BLOCK_Y = 38;

const HOPPER = { cx: -142, floor: -190, throat: -96 };
const STACK_IN = 18;
const OUT_STACK = { cx: 130, top: 17.4 };
const START_CX = -44;

const SUPPLY = { x: -36, z: 42, r: 9, core: 4.5 };
const TAKEUP = { x: 36, z: 42, r: 6.5, core: 4.5 };
const FLANGE_R = 12;
const FLANGE_T = 1.2;
const GUIDE = { x: -17, z: RIBBON_Z + 2, r: 2 };
const PEEL = { x: 15, z: RIBBON_Z + 2, r: 2 };
const RIBBON_HALF = 33;
const PANEL = { length: 92, pitch: 96 };
const INKS = ["Y", "M", "C", "K", "O"];

const HEAD = { x: -6, y: -36, w: 12, d: 72, r: 1 };
const SINK = { x: -8, y: -34, w: 16, d: 68, r: 1.5 };
const HEAD_H = 8;
const SINK_H = 11;
const ARM = { x: -11, y: WALL_IN, w: 22, d: 40 - WALL_IN, r: 2 };
const ARM_Z = 50;
const ARM_H = 7;
const POST_Y = [-22, 22];

const PULLEYS = [
  { x: -64, z: LOWER_Z, r: 4 },
  { x: 0, z: LOWER_Z, r: 4 },
  { x: 64, z: LOWER_Z, r: 4 },
  { x: 32, z: 7, r: 3 },
  { x: -32, z: 7, r: 3 },
];
const BELT = { y0: FRAME_OUT + 0.8, y1: FRAME_OUT + 3, t: 1.2, flange: 0.8 };

const CONSOLE = { x: 98, y: 40, w: 56, d: 22, r: 2 };
const CONSOLE_H = 28;
const LCD = { x: 104, z: 22, w: 34, h: 11 };

const P = k.fitProjection(
  [...k.boxCorners(BASE, -PLATE_H - FOOT_H, 0), [WALL.x, WALL.y, WALL_H], [WALL.x + WALL.w, WALL.y, WALL_H], [-194, -40, 46]],
  W,
  H,
  { pad: 18, azimuth: 54, elevation: 34 },
);
const V = G.viewOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (value) => Math.round(value * 100) / 100;
const f3 = (value) => Math.round(value * 1000) / 1000;

const R = A.recorder(P);
let order = 0;
function put(name, svg, shapes = [], extra = {}) {
  return R.put({ name, key: order++, svg, shapes: shapes.map((shape) => (shape.kind === "tube" ? shape : R.solid({ ...shape, name }))), ...extra });
}
const slabShape = (plan, z, h, steps = 3) => A.slab(plan, z, h, {}, steps);
function slab(name, plan, z, h, style = {}, { steps = 3, bevel = 0, extra = "", inner = "" } = {}) {
  put(name, S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", inner, ...style }) + extra, [slabShape(plan, z, h, steps)]);
}
function post(name, cx, cy, r, z, h, style = {}, { steps = 24, extra = "" } = {}) {
  put(name, S(k.cylinder(cx, cy, r, z, h, P, steps), { tone: "mid", ...style }) + extra, [A.cylinder(cx, cy, r, z, h)]);
}
const ACROSS = (x, z) => G.frameOf([x, 0, z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
function rod(name, x, z, y0, y1, r, style = {}, { extra = "", inner = "" } = {}) {
  const F = ACROSS(x, z);
  put(name, S(G.disc(y0, y1, r, F, P), { tone: "mid", inner, ...style }) + extra, [A.disc(F, y0, y1, r)]);
}
const ringAcross = (x, z, r, y, steps = 28) =>
  path3(Array.from({ length: steps }, (_, i) => [x + Math.cos((i / steps) * Math.PI * 2) * r, y, z + Math.sin((i / steps) * Math.PI * 2) * r]), true);

// Parts that turn: the page redraws their marks every frame from this table.
const SPINS = [];
function spin(x, z, y, r0, r1, count, drive, ratio) {
  SPINS.push({ x, z, y, r0, r1, count, drive, ratio });
  return `<path class="iso-line" data-tone="mid" data-spin="${SPINS.length - 1}" d=""/>`;
}

// ---------- base ----------
const HALO = `<path class="iso-halo" d="${k.haloOf(BASE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`;
for (const [x, y] of k.corners(BASE, 24)) {
  put(
    "stand.foot",
    S(k.cylinder(x, y, 9, -PLATE_H - FOOT_H, 1.8, P, 28), { tone: "lo" }) + S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }),
    [A.cylinder(x, y, 9, -PLATE_H - FOOT_H, 1.8), A.cylinder(x, y, 7, -PLATE_H - FOOT_H + 1.8, FOOT_H - 1.8)],
  );
}
{
  const screws = k.corners(BASE, 10);
  const strip = { x: -150, y: BASE.y + BASE.d - 13, w: 236, d: 7, r: 1 };
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.5, [2, 3.8], P);
  const extra = [
    Ln(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: "lo" }),
    Ln(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }),
    Dots(screws.map(([x, y]) => at([x, y, 0])), { size: 0.55 }),
    S(k.slabOf(strip, 0, 0.5, P, 3), { tone: "lo", crease: "none" }),
    Ln(ticks.minor, { tone: "lo" }),
    Ln(ticks.major, { tone: "mid" }),
    Dots([at([strip.x + 2, strip.y + 3.5, 0.5]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.5])], { size: 0.45 }),
  ].join("");
  put("base.plate", S(k.slabOf(BASE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid" }) + extra, [slabShape(BASE, -PLATE_H, PLATE_H, 8), slabShape(strip, 0, 0.5)]);
}

// ---------- power supply and its cable to the back wall ----------
{
  const PSU = { x: 186, y: -52, w: 12, d: 40, r: 1.5 };
  const top = 18;
  const vents = Array.from({ length: 5 }, (_, i) => k.planOutline({ x: PSU.x + 2.4 + i * 1.8, y: PSU.y + 6, w: 0.8, d: 26, r: 0.4 }, top, P, 2)).join("");
  const screws = [[PSU.x + 2, PSU.y + 2.5], [PSU.x + PSU.w - 2, PSU.y + 2.5], [PSU.x + 2, PSU.y + PSU.d - 2.5], [PSU.x + PSU.w - 2, PSU.y + PSU.d - 2.5]];
  slab("psu", PSU, 0, top, {}, { steps: 3, bevel: 0.6, extra: Ln(vents, { tone: "faint" }) + Dots(screws.map(([x, y]) => at([x, y, top])), { size: 0.45 }) });
  const X = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const rocker = [[-30, 8], [-23, 8], [-23, 14], [-30, 14]];
  put("psu.switch", S(G.prismOf(X, rocker, PSU.x + PSU.w, PSU.x + PSU.w + 1.4, P), { tone: "hi", crease: "lo" }) + Ln(path3([[PSU.x + PSU.w + 1.4, -26.5, 8.6], [PSU.x + PSU.w + 1.4, -26.5, 13.4]]), { tone: "lo" }), [A.prism(X, rocker, PSU.x + PSU.w, PSU.x + PSU.w + 1.4)]);
  const r = 1.4;
  const route = G.fillet([[PSU.x, -40, 6], [PSU.x - 6, -40, 6], [PSU.x - 14, -41, r], [112, -44, r], [100, -51, r], [WALL.x + WALL.w + 8, -51, 6], [WALL.x + WALL.w, -51, 6]], 4.2, 10, { P, tube: r });
  R.route("cable.power", route, r, { limp: true, touch: ["base.plate"] });
  tubePieces(route, r, P, { maxLength: 16, spacing: 1.2 }).forEach((piece, chunk) =>
    put("cable.power", tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii)], { route: "cable.power", chunk }));
}

// ---------- back wall ----------
{
  const face = WALL_IN;
  const vents = Array.from({ length: 9 }, (_, i) => {
    const x = -80 + i * 6.5;
    return path3([[x, face, 56], [x + 2.4, face, 56], [x + 2.4, face, 44], [x, face, 44]], true);
  }).join("");
  const screws = [-84, -54, 54, 84].flatMap((x) => [[x, face, 59], [x, face, 6]]);
  const bores = [[-64, LOWER_Z], [0, LOWER_Z], [64, LOWER_Z], [-64, UPPER_Z], [64, UPPER_Z], [SUPPLY.x, SUPPLY.z], [TAKEUP.x, TAKEUP.z]];
  const extra = [
    Ln(vents, { tone: "faint" }),
    Ln(screws.map(([x, y, z]) => ringAcross(x, z, 1.6, y, 14)).join(""), { tone: "lo" }),
    Dots(screws.map(at), { size: 0.5 }),
    Ln(bores.map(([x, z]) => ringAcross(x, z, 4.4, face, 24)).join(""), { tone: "lo" }),
  ].join("");
  slab("wall", WALL, 0, WALL_H, {}, { steps: 2, bevel: 0.6, extra });
  for (const x of [-76, 76]) slab("wall.gusset", { x: x - 2, y: WALL_IN, w: 4, d: 14, r: 0.6 }, 0, 12, {}, { steps: 2 });
}

// ---------- controller board on stand-offs ----------
{
  const F = ACROSS(0, 0);
  const box = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const BOARD = { x0: 50, z0: 33, x1: 86, z1: 58, y0: WALL_IN + 3, y1: WALL_IN + 4.6 };
  const face = BOARD.y1;
  const prism = (name, poly, y0, y1, style = {}, extra = "") => put(name, S(G.prismOf(F, poly, y0, y1, P), { tone: "mid", ...style }) + extra, [A.prism(F, poly, y0, y1)]);
  for (const [x, z] of [[BOARD.x0 + 2.5, BOARD.z0 + 2.5], [BOARD.x1 - 2.5, BOARD.z0 + 2.5], [BOARD.x0 + 2.5, BOARD.z1 - 2.5], [BOARD.x1 - 2.5, BOARD.z1 - 2.5]]) {
    rod("board.standoff", x, z, WALL_IN, BOARD.y0, 1.3, { tone: "lo" });
  }
  const pads = [];
  const traces = [];
  const run = (points) => {
    traces.push(path3(points.map(([x, z]) => [x, face, z])));
    pads.push(points[0], points[points.length - 1]);
  };
  run([[60, 41], [60, 38], [56.5, 38]]);
  run([[62, 41], [62, 37], [56.5, 37]]);
  run([[64, 41], [64, 36], [70, 36], [70, 38.5]]);
  run([[68.5, 47], [71.5, 47]]);
  run([[68.5, 45], [71.5, 45], [71.5, 43.5]]);
  run([[78.5, 50], [82, 50], [82, 39]]);
  const board = [
    Ln(traces.join(""), { tone: "lo" }),
    Dots(pads.map(([x, z]) => at([x, face, z])), { size: 0.5, tone: "mid" }),
    Ln(ringAcross(BOARD.x0 + 2.5, BOARD.z0 + 2.5, 1.9, face, 14) + ringAcross(BOARD.x1 - 2.5, BOARD.z0 + 2.5, 1.9, face, 14) + ringAcross(BOARD.x0 + 2.5, BOARD.z1 - 2.5, 1.9, face, 14) + ringAcross(BOARD.x1 - 2.5, BOARD.z1 - 2.5, 1.9, face, 14), { tone: "lo" }),
    Dots([[BOARD.x0 + 2.5, BOARD.z0 + 2.5], [BOARD.x1 - 2.5, BOARD.z0 + 2.5], [BOARD.x0 + 2.5, BOARD.z1 - 2.5], [BOARD.x1 - 2.5, BOARD.z1 - 2.5]].map(([x, z]) => at([x, face, z])), { size: 0.55 }),
  ].join("");
  prism("board", box(BOARD.x0, BOARD.z0, BOARD.x1, BOARD.z1), BOARD.y0, BOARD.y1, { tone: "mid" }, board);
  const pins = (x0, x1, z, n) => Array.from({ length: n }, (_, i) => at([x0 + ((x1 - x0) * (i + 0.5)) / n, face + 0.2, z]));
  prism("board.mcu", box(58, 41, 68.5, 51.5), face, face + 1.2, { tone: "hi", crease: "lo" }, Dots([...pins(58, 68.5, 40.4, 8), ...pins(58, 68.5, 52.1, 8)], { size: 0.35, tone: "mid" }) + Dots([at([59.6, face + 1.2, 50])], { size: 0.45, tone: "lo" }));
  prism("board.driver", box(71.5, 46, 78.5, 53), face, face + 1, { tone: "mid" }, Dots([...pins(71.5, 78.5, 45.5, 5), ...pins(71.5, 78.5, 53.5, 5)], { size: 0.3, tone: "mid" }));
  prism("board.driver", box(69, 38.5, 76, 43.5), face, face + 1, { tone: "mid" }, Dots(pins(69, 76, 38, 5), { size: 0.3, tone: "mid" }));
  prism("board.header", box(52.5, 35, 56.5, 47), face, face + 2.4, { tone: "lo" }, Dots(Array.from({ length: 10 }, (_, i) => at([53.5 + (i % 2) * 2, face + 2.4, 36 + Math.floor(i / 2) * 2.4])), { size: 0.4, tone: "hi" }));
  for (const [x, z] of [[54.5, 54.5], [80.5, 55], [83, 44]]) {
    const C = ACROSS(x, z);
    rod("board.cap", x, z, face, face + 3.6, 1.5, { tone: "hi", crease: "lo" }, { extra: Ln(G.circleOf(C, face + 3.6, 0.7, P), { tone: "lo" }) });
  }
}

// ---------- input hopper ----------
const HOP = { x: HOPPER.floor, y: -36, w: HOPPER.throat - HOPPER.floor, d: 72, r: 1 };
slab("hopper.back", { x: HOPPER.floor - 4, y: -38, w: 4, d: 76, r: 0.8 }, 0, 46, {}, { steps: 2, bevel: 0.5, extra: Dots([at([HOPPER.floor - 2, -30, 46]), at([HOPPER.floor - 2, 30, 46])], { size: 0.45 }) });
for (const x of [HOPPER.floor + 10, HOPPER.throat - 10]) {
  for (const y of [-30, 26]) slab("hopper.leg", { x: x - 2, y, w: 4, d: 4, r: 0.6 }, 0, ZC - 4, {}, { steps: 2 });
}
slab("hopper.floor", HOP, ZC - 4, 4, {}, { steps: 2, bevel: 0.5 });
slab("hopper.guide.far", { x: HOPPER.floor, y: -38, w: HOPPER.throat - HOPPER.floor - 4, d: 2.5, r: 0.5 }, ZC, 12, {}, { steps: 2 });

// ---------- output tray ----------
const TRAY = { x: 80, y: -36, w: 98, d: 72, r: 1.5 };
slab("tray.floor", TRAY, 0, 4, {}, { steps: 3, bevel: 0.5 });
slab("tray.stop", { x: TRAY.x + TRAY.w, y: -36, w: 4, d: 72, r: 0.8 }, 0, 24, {}, { steps: 2, bevel: 0.5, extra: Dots([at([TRAY.x + TRAY.w + 2, -28, 24]), at([TRAY.x + TRAY.w + 2, 28, 24])], { size: 0.45 }) });
slab("tray.guide.far", { x: TRAY.x + 4, y: -36, w: TRAY.w - 8, d: 2.5, r: 0.5 }, 4, 10, {}, { steps: 2 });

// Card faces are drawn in card-local millimetres (63 × 88, origin top left, top edge leading along +x).
const AXIS_U = k.axisVector(P, [0, 1, 0]);
const AXIS_V = k.axisVector(P, [-1, 0, 0]);
const faceMatrix = (cx, z) => {
  const o = at([cx + CARD.L / 2, -CARD.W / 2, z]);
  return `matrix(${[AXIS_U[0], AXIS_U[1], AXIS_V[0], AXIS_V[1], o[0], o[1]].map(f3).join(" ")})`;
};
const cardPlan = (cx) => ({ x: cx - CARD.L / 2, y: -CARD.W / 2, w: CARD.L, d: CARD.W, r: CARD.R });
function stack(name, cx, z0, z1, count, face = "") {
  const plan = cardPlan(cx);
  const lines = Array.from({ length: count - 1 }, (_, i) => k.sideSeam(plan, z0 + ((z1 - z0) * (i + 1)) / count, P, 3)).join("");
  put(name, S(k.slabOf(plan, z0, z1 - z0, P, 3), { tone: "hi", crease: "lo", className: "press-paper", inner: Ln(lines, { tone: "lo" }) }) + face, [slabShape(plan, z0, z1 - z0)]);
}

// Card 54 of 55, already printed, on top of the output stack.
const OLD_FACE = [
  `<rect width="63" height="88" rx="2.6" fill="#0c0c0c"/>`,
  `<rect x="2.6" y="2.6" width="57.8" height="82.8" rx="1.6" fill="#3f8a4e"/>`,
  `<rect x="4.2" y="4.4" width="54.6" height="6.4" rx="3.2" fill="#d7e4cf"/>`,
  `<rect x="7" y="6.9" width="26" height="1.4" rx="0.7" fill="#2c3a2a"/>`,
  `<circle cx="55.4" cy="7.6" r="2.1" fill="#a7d08c"/>`,
  `<rect x="5.4" y="12.4" width="52.2" height="33.6" fill="#1d3a28"/>`,
  `<path d="M5.4 46 22 27 31 36 41 22 57.6 46Z" fill="#2f6b41"/>`,
  `<circle cx="45" cy="19" r="4" fill="#e7e2a8"/>`,
  `<rect x="4.2" y="47.4" width="54.6" height="5.4" rx="2.7" fill="#d7e4cf"/>`,
  `<rect x="5.4" y="54.4" width="52.2" height="25.4" rx="0.8" fill="#e8efe2"/>`,
  ...[59, 63, 67, 72].map((y, i) => `<rect x="8" y="${y}" width="${[44, 40, 30, 22][i]}" height="1.3" rx="0.65" fill="#55604f"/>`),
  `<rect x="45.8" y="79.4" width="13" height="5.6" rx="1.2" fill="#d7e4cf"/>`,
].join("");
stack("tray.stack", OUT_STACK.cx, 4, OUT_STACK.top, 12, `<g transform="${faceMatrix(OUT_STACK.cx, OUT_STACK.top)}">${OLD_FACE}</g>`);

// ---------- lower rollers, under the card ----------
const rollerSeams = (x, z, r) => {
  const F = ACROSS(x, z);
  return Ln(G.arcOf(F, -ROLL_HALF + 2.5, r, P) + G.arcOf(F, ROLL_HALF - 2.5, r, P), { tone: "faint" });
};
for (const x of [PAIRS[0], 0, PAIRS[1]]) {
  rod("roller.shaft.far", x, LOWER_Z, WALL_IN, -ROLL_HALF, SHAFT_R);
  rod(x === 0 ? "platen" : "roller.lower", x, LOWER_Z, -ROLL_HALF, ROLL_HALF, ROLL_R, { tone: x === 0 ? "lo" : "mid" }, { inner: rollerSeams(x, LOWER_Z, ROLL_R) });
  rod("roller.shaft.near", x, LOWER_Z, ROLL_HALF, FRAME.y, SHAFT_R);
}

// ---------- the moving card ----------
const CARD_SLOT = order++;

// ---------- hopper stack, gate and near guide ----------
{
  const h = STACK_IN * 0.66;
  stack("hopper.stack", HOPPER.cx, FACE_Z, ZC + h, STACK_IN);
  const plan = cardPlan(HOPPER.cx);
  const weight = { x: plan.x + 8, y: -24, w: plan.w - 16, d: 48, r: 2 };
  const weightTop = ZC + h + 3;
  const weightScrews = k.corners(weight, 5);
  slab("hopper.weight", weight, ZC + h, 3, {}, { steps: 3, bevel: 0.6, extra: Ln(k.planOutline(k.insetPlan(weight, 9), weightTop, P, 3), { tone: "faint" }) + Dots(weightScrews.map(([x, y]) => at([x, y, weightTop])), { size: 0.45 }) });
  const top = ZC + h + 8;
  post("hopper.knob", HOPPER.cx, 0, 4.5, ZC + h + 3, 5, {}, { extra: Ln(k.knurl(HOPPER.cx, 0, 4.5, ZC + h + 3, top, 30, P), { tone: "lo" }) + Dots([at([HOPPER.cx, 0, top])], { size: 0.5, tone: "hi" }) });
  slab("hopper.gate", { x: HOPPER.throat, y: -38, w: 4, d: 76, r: 0.6 }, FACE_Z + 0.4, 18, {}, { steps: 2, bevel: 0.4, extra: Dots([at([HOPPER.throat + 4, -30, FACE_Z + 12]), at([HOPPER.throat + 4, 30, FACE_Z + 12])], { size: 0.45 }) });
  // Adjustment slots and screws on the near guide's outer face.
  const face = 38;
  const slots = [-170, -130].map((x) => path3([[x, face, ZC + 3.4], [x + 14, face, ZC + 3.4], [x + 14, face, ZC + 5.6], [x, face, ZC + 5.6]], true)).join("");
  const guideExtra = Ln(slots, { tone: "lo" }) + Dots([-163, -123].map((x) => at([x, face, ZC + 4.5])), { size: 0.5, tone: "hi" });
  slab("hopper.guide.near", { x: HOPPER.floor, y: 35.5, w: HOPPER.throat - HOPPER.floor, d: 2.5, r: 0.5 }, ZC, 9, {}, { steps: 2, extra: guideExtra });
}

// ---------- upper (pinch) rollers ----------
for (const x of PAIRS) {
  rod("roller.upper.shaft.far", x, UPPER_Z, WALL_IN, -ROLL_HALF, SHAFT_R);
  rod("roller.upper", x, UPPER_Z, -ROLL_HALF, ROLL_HALF, ROLL_R, { tone: "hi", crease: "lo" }, { inner: rollerSeams(x, UPPER_Z, ROLL_R) });
  rod("roller.upper.shaft.near", x, UPPER_Z, ROLL_HALF, BLOCK_Y, SHAFT_R);
}

// ---------- ribbon cassette ----------
for (const spool of [SUPPLY, TAKEUP]) {
  rod("spool.spindle", spool.x, spool.z, WALL_IN, -RIBBON_HALF - FLANGE_T, 2.5);
  rod("spool.flange.far", spool.x, spool.z, -RIBBON_HALF - FLANGE_T, -RIBBON_HALF, FLANGE_R, { tone: "lo" });
}
for (const roller of [GUIDE, PEEL]) rod("ribbon.shaft", roller.x, roller.z, WALL_IN, -ROLL_HALF, 1.2);
rod("spool.supply", SUPPLY.x, SUPPLY.z, -RIBBON_HALF, RIBBON_HALF, SUPPLY.r, { tone: "mid" });
const RIBBON_SLOTS = [order++, order++];
rod("ribbon.guide", GUIDE.x, GUIDE.z, -ROLL_HALF, ROLL_HALF, GUIDE.r, { tone: "hi", crease: "lo" });
const HEAD_SLOT = order++;
{
  const screws = [[-6, -42], [6, -42], [-6, 34], [6, 34]];
  const extra = Ln(screws.map(([x, y]) => k.ring(x, y, 1.6, ARM_Z + ARM_H, P, 14)).join(""), { tone: "lo" }) + Dots(screws.map(([x, y]) => at([x, y, ARM_Z + ARM_H])), { size: 0.5 });
  put("head.arm", S(k.slabOf(ARM, ARM_Z, ARM_H, P, 3, 0.6), { tone: "mid" }) + extra, [{ ...slabShape(ARM, ARM_Z, ARM_H), owner: "head" }]);
}
{
  const plug = { x: -3, y: -38, w: 6, d: 6, r: 0.8 };
  const plugTop = ARM_Z + ARM_H + 3;
  put("head.plug", S(k.slabOf(plug, ARM_Z + ARM_H, 3, P, 2, 0.3), { tone: "lo" }), [slabShape(plug, ARM_Z + ARM_H, 3, 2)]);
  const r = 0.9;
  const route = G.fillet([[64, WALL_IN + 3.8, 58], [64, WALL_IN + 3.8, 62], [6, WALL_IN + 3.8, 62], [0, -35, 62], [0, -35, plugTop]], 3, 10, { P, tube: r });
  R.route("cable.head", route, r, { limp: true });
  tubePieces(route, r, P, { maxLength: 14, spacing: 1 }).forEach((piece, chunk) =>
    put("cable.head", tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii)], { route: "cable.head", chunk }));
}
rod("ribbon.peel", PEEL.x, PEEL.z, -ROLL_HALF, ROLL_HALF, PEEL.r, { tone: "hi", crease: "lo" });
RIBBON_SLOTS.push(order++);
rod("spool.takeup", TAKEUP.x, TAKEUP.z, -RIBBON_HALF, RIBBON_HALF, TAKEUP.r, { tone: "mid" });
for (const [name, spool] of [["supply", SUPPLY], ["takeup", TAKEUP]]) {
  const y = RIBBON_HALF + FLANGE_T;
  const F = ACROSS(spool.x, spool.z);
  rod("spool.flange.near", spool.x, spool.z, RIBBON_HALF, y, FLANGE_R, { tone: "lo" }, { extra: Ln(G.circleOf(F, y, FLANGE_R - 2.4, P), { tone: "faint" }) + spin(spool.x, spool.z, y, 3.6, FLANGE_R - 2.4, 3, name, 1 / spool.r) });
  rod("spool.hub", spool.x, spool.z, y, y + 2, 3.6, {}, { extra: Dots([at([spool.x, y + 2, spool.z])], { size: 0.55, tone: "hi" }) });
}

// ---------- near frame, pillow blocks and the drive belt ----------
{
  const screws = [-84, 84].flatMap((x) => [[x, FRAME_OUT, 18], [x, FRAME_OUT, 4]]);
  slab("frame", FRAME, 0, FRAME_H, {}, { steps: 2, bevel: 0.6, extra: Ln(screws.map(([x, y, z]) => ringAcross(x, z, 1.6, y, 14)).join(""), { tone: "lo" }) + Dots(screws.map(at), { size: 0.5 }) });
  for (const x of PAIRS) {
    const block = { x: x - 7, y: BLOCK_Y, w: 14, d: FRAME_OUT - BLOCK_Y, r: 1 };
    const bearing = SHAFT_R + 1.4;
    const extra = Ln(ringAcross(x, UPPER_Z, bearing, FRAME_OUT), { tone: "lo" }) + spin(x, UPPER_Z, FRAME_OUT, 0, bearing, 1, "card", 1 / ROLL_R) + Dots([at([x, FRAME_OUT, UPPER_Z]), at([x - 4.5, FRAME_OUT, FRAME_H + 9.5]), at([x + 4.5, FRAME_OUT, FRAME_H + 9.5])], { size: 0.45 });
    slab("frame.block", block, FRAME_H, 12, {}, { steps: 2, bevel: 0.5, extra });
  }
  // The pulley's own face is hidden by its outer flange, so the core stops short of the belt's edge.
  for (const p of PULLEYS) {
    rod("belt.pulley", p.x, p.z, FRAME_OUT, BELT.y1 - 0.8, p.r, { tone: "mid" });
    rod("belt.hub", p.x, p.z, BELT.y1 - 0.8, BELT.y1, 1.8, { tone: "mid" });
  }
}

// The belt is the hull of its pulleys, lying in the plane of the frame's outer face.
function hullXZ(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => list.reduce((out, p) => {
    while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
    out.push(p);
    return out;
  }, []);
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}
const beltRing = (grow) => hullXZ(PULLEYS.flatMap((p) => Array.from({ length: 96 }, (_, i) => [p.x + Math.cos((i / 96) * Math.PI * 2) * (p.r + grow), p.z + Math.sin((i / 96) * Math.PI * 2) * (p.r + grow)])));
{
  const inner = beltRing(0);
  const outer = beltRing(BELT.t);
  const y = BELT.y1;
  const band = path3(outer.map(([x, z]) => [x, y, z]), true) + path3([...inner].reverse().map(([x, z]) => [x, y, z]), true);
  const strips = [];
  outer.forEach(([x0, z0], i) => {
    const [x1, z1] = outer[(i + 1) % outer.length];
    const normal = G.unit3([z1 - z0, 0, -(x1 - x0)]);
    if (G.dot3(normal, V) > 0) strips.push({ d: path3([[x0, BELT.y0, z0], [x1, BELT.y0, z1], [x1, y, z1], [x0, y, z0]], true), tone: G.toneOf(normal, P) });
  });
  const svg = [
    `<g class="iso-solid">`,
    ...strips.map((s) => (s.tone === 4 ? `<path class="iso-top" d="${s.d}"/>` : `<path class="iso-shade" data-shade="${s.tone}" d="${s.d}"/>`)),
    `<path class="iso-fill" fill-rule="evenodd" d="${band}"/>`,
    `<path class="iso-shade" data-shade="1" fill-rule="evenodd" d="${band}"/>`,
    `<path class="press-teeth" data-press="teeth" d="${path3(beltRing(BELT.t * 0.45).map(([x, z]) => [x, y, z]), true)}"/>`,
    `<path class="iso-line iso-edge" data-tone="mid" d="${band}"/>`,
    `</g>`,
  ].join("");
  const mid = beltRing(BELT.t / 2).map(([x, z]) => [x, (BELT.y0 + BELT.y1) / 2, z]);
  const tube = R.route("belt", [...mid, mid[0]], BELT.t / 2, { closed: true, touch: ["belt.pulley", "belt.flange"] });
  put("belt", svg, tube);
  // Each pulley's outer flange keeps the belt on; it is drawn over the belt.
  PULLEYS.forEach((p, i) => {
    const y = BELT.y1 + BELT.flange;
    const ratio = i < 3 ? -1 / ROLL_R : -(4 / ROLL_R) / p.r;
    const extra = Ln(ringAcross(p.x, p.z, 1.4, y, 16), { tone: "lo" }) + spin(p.x, p.z, y, 1.4, p.r + 0.6, 2, "card", ratio) + Dots([at([p.x, y, p.z])], { size: 0.45, tone: "hi" });
    rod("belt.flange", p.x, p.z, BELT.y1, y, p.r + 1.6, { tone: "mid" }, { extra });
  });
}

// ---------- console with the counter ----------
{
  const front = CONSOLE.y + CONSOLE.d;
  const top = CONSOLE_H;
  const led = at([146, CONSOLE.y + 15, top]);
  const extra = [
    Ln(k.planOutline(k.insetPlan(CONSOLE, 2.5), top, P, 3), { tone: "faint" }),
    Dots([[CONSOLE.x + 4, CONSOLE.y + 4], [CONSOLE.x + CONSOLE.w - 4, CONSOLE.y + 4], [CONSOLE.x + 4, front - 4], [CONSOLE.x + CONSOLE.w - 4, front - 4]].map(([x, y]) => at([x, y, top])), { size: 0.5 }),
    Dots([at([140, CONSOLE.y + 15, top])], { size: 1.1, tone: "hi" }),
    `<circle class="press-led" data-press="led" cx="${f2(led[0])}" cy="${f2(led[1])}" r="1.1"/>`,
  ].join("");
  slab("console", CONSOLE, 0, CONSOLE_H, {}, { steps: 3, bevel: 0.8, extra });
  const F = ACROSS(0, 0);
  const poly = [[LCD.x - 2, LCD.z - LCD.h - 2], [LCD.x + LCD.w + 2, LCD.z - LCD.h - 2], [LCD.x + LCD.w + 2, LCD.z + 2], [LCD.x - 2, LCD.z + 2]];
  const face = front + 0.8;
  const glass = path3([[LCD.x, face, LCD.z], [LCD.x + LCD.w, face, LCD.z], [LCD.x + LCD.w, face, LCD.z - LCD.h], [LCD.x, face, LCD.z - LCD.h]], true);
  const lcd = [
    `<path class="press-lcd" d="${glass}"/>`,
    `<g transform="${k.sideMatrix([LCD.x, face], LCD.z, P, "left")}">`,
    `<text class="press-lcd-text" data-press="count" x="3" y="6.6" font-size="5.8">54/55</text>`,
    ...INKS.map((ink, i) => `<rect class="press-ink" data-ink="${ink}" x="${3 + i * 4.6}" y="8.2" width="3.4" height="1.3" rx="0.3"/>`),
    `</g>`,
    Ln(glass, { tone: "lo" }),
  ].join("");
  put("console.bezel", S(G.prismOf(F, poly, front, face, P), { tone: "lo" }) + lcd, [A.prism(F, poly, front, face)]);
  for (const x of [114, 122, 130]) post("console.button", x, CONSOLE.y + 15, 2.6, top, 1.6, { tone: "hi", crease: "lo" }, { steps: 20 });
  const label = { x: CONSOLE.x + 6, y: CONSOLE.y + 3.5, w: 22, d: 6.5, r: 0.8 };
  slab("console.label", label, top, 0.4, { tone: "lo", crease: "none" }, {
    extra: k.faceTextSvg(k.topMatrix([label.x + 2.2, label.y + 4.6], top + 0.4, P, "x"), "BLP-55", { size: 3.4, tone: "mid" }) + Dots([at([label.x + 1.2, label.y + 1.2, top + 0.4]), at([label.x + label.w - 1.2, label.y + 1.2, top + 0.4])], { size: 0.35 }),
  });
}
slab("tray.guide.near", { x: TRAY.x + 4, y: 33.5, w: TRAY.w - 8, d: 2.5, r: 0.5 }, 4, 10, {}, { steps: 2 });

// ---------- the ribbon path ----------
// Signed radii: negative for a roll turning clockwise (seen with x right and z up).
function tangent([c1x, c1z], rho1, [c2x, c2z], rho2) {
  const dx = c2x - c1x;
  const dz = c2z - c1z;
  const d2 = dx * dx + dz * dz;
  const a = (rho1 - rho2) / d2;
  const b = Math.sqrt(d2 - (rho1 - rho2) ** 2) / d2;
  for (const sign of [1, -1]) {
    const m = [a * dx - sign * b * dz, a * dz + sign * b * dx];
    const p1 = [c1x + rho1 * m[0], c1z + rho1 * m[1]];
    const p2 = [c2x + rho2 * m[0], c2z + rho2 * m[1]];
    if ((p2[0] - p1[0]) * -m[1] + (p2[1] - p1[1]) * m[0] > 0) return [p1, p2];
  }
  throw new Error("no tangent");
}
const [s1a, s1b] = tangent([SUPPLY.x, SUPPLY.z], -SUPPLY.r, [GUIDE.x, GUIDE.z], GUIDE.r);
const [s3a, s3b] = tangent([PEEL.x, PEEL.z], PEEL.r, [TAKEUP.x, TAKEUP.z], -TAKEUP.r);
const RIBBON = [[s1a, s1b], [[GUIDE.x, RIBBON_Z], [PEEL.x, RIBBON_Z]], [s3a, s3b]];
const wrap = (c, r, a, b) => r * Math.abs(Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
const RIBBON_S = [];
{
  let s = 0;
  RIBBON.forEach(([a, b], i) => {
    if (i === 1) s += wrap([GUIDE.x, GUIDE.z], GUIDE.r, s1b, a);
    if (i === 2) s += wrap([PEEL.x, PEEL.z], PEEL.r, RIBBON[1][1], a);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    RIBBON_S.push([s, s + length]);
    s += length;
  });
}
const RIBBON_HEAD = RIBBON_S[1][0] - GUIDE.x;
const FLAT = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
RIBBON.forEach(([a, b], i) => {
  const quad = [[a[0], -RIBBON_HALF, a[1]], [b[0], -RIBBON_HALF, b[1]], [b[0], RIBBON_HALF, b[1]], [a[0], RIBBON_HALF, a[1]]];
  const panels = INKS.map((ink) => `<path class="press-panel" data-ink="${ink}" d=""/>`).join("");
  const svg = `<g data-press="ribbon"><path class="press-film" d="${path3(quad, true)}"/>${panels}${Ln(path3([quad[0], quad[1]]) + path3([quad[3], quad[2]]), { tone: "lo" })}</g>`;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = [(-(b[1] - a[1]) / length) * 0.05, ((b[0] - a[0]) / length) * 0.05];
  const poly = [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
  put(`ribbon.${i}`, svg, [A.prism(FLAT, poly, -RIBBON_HALF, RIBBON_HALF)], { key: RIBBON_SLOTS[i] });
});

// ---------- the print head, drawn down on the ribbon ----------
{
  const z0 = RIBBON_Z;
  const sinkTop = z0 + HEAD_H + SINK_H;
  const fins = Array.from({ length: 15 }, (_, i) => SINK.y + 3 + i * 4.4);
  const postTop = ARM_Z + 2;
  const svg = [
    S(k.slabOf(HEAD, z0, HEAD_H, P, 2, 0.4), { tone: "mid" }),
    `<path class="iso-line press-heat" data-press="heat" d="${path3([[HEAD.x + HEAD.w, HEAD.y + 1, z0 + 0.3], [HEAD.x + HEAD.w, HEAD.y + HEAD.d - 1, z0 + 0.3]])}"/>`,
    S(k.slabOf(SINK, z0 + HEAD_H, SINK_H, P, 2, 0.4), { tone: "mid", inner: Ln(fins.map((y) => path3([[SINK.x + SINK.w, y, z0 + HEAD_H], [SINK.x + SINK.w, y, sinkTop]])).join(""), { tone: "lo" }) }),
    Ln(fins.map((y) => path3([[SINK.x, y, sinkTop], [SINK.x + SINK.w, y, sinkTop]])).join(""), { tone: "faint" }),
    ...POST_Y.map((y) => S(k.cylinder(0, y, 2.4, sinkTop, postTop - sinkTop, P, 18), { tone: "mid", crease: "none" })),
    S(k.slabOf({ x: -4, y: 26, w: 8, d: 6, r: 0.6 }, sinkTop, 2.6, P, 2), { tone: "lo" }),
  ].join("");
  put("head", `<g data-press="head">${svg}</g>`, [
    slabShape(HEAD, z0, HEAD_H, 2),
    slabShape(SINK, z0 + HEAD_H, SINK_H, 2),
    ...POST_Y.map((y) => ({ ...A.cylinder(0, y, 2.4, sinkTop, postTop - sinkTop), owner: "head" })),
    slabShape({ x: -4, y: 26, w: 8, d: 6, r: 0.6 }, sinkTop, 2.6, 2),
  ], { key: HEAD_SLOT });
}

// ---------- card 55 ----------
const PAPER = [244, 244, 242];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
// What the card shows once the given inks are down: the colour separated by grey-component
// replacement, then each applied ink multiplied onto the paper.
function inked(colour, inks) {
  const [r, g, b] = hex(colour).map((v) => v / 255);
  const key = 1 - Math.max(r, g, b);
  const part = (v) => (key < 1 ? (1 - v - key) / (1 - key) : 0);
  const use = (ink, value) => (inks.includes(ink) ? value : 0);
  const black = 1 - use("K", key);
  return toHex([part(r), part(g), part(b)].map((value, i) => PAPER[i] * (1 - use(["C", "M", "Y"][i], value)) * black));
}
function heroFace(paint) {
  const petals = [-72, -36, 0, 36, 72].map((angle) => `<path d="M0 0C-5.6 -8.6 -5 -18 0 -23.6C5 -18 5.6 -8.6 0 0Z" fill="${paint("#3a2850")}" stroke="${paint("#c08ad8")}" stroke-width="0.4" transform="rotate(${angle})"/>`);
  const bar = (y, h) => `<rect x="4.2" y="${y}" width="54.6" height="${h}" rx="${h / 2}" fill="${paint("#34343a")}" stroke="${paint("#6a6a6a")}" stroke-width="0.3"/>`;
  return [
    `<rect width="63" height="88" rx="2.6" fill="${paint("#0c0c0c")}"/>`,
    `<rect x="2.6" y="2.6" width="57.8" height="82.8" rx="1.6" fill="${paint("#202024")}"/>`,
    bar(4.4, 6.6),
    `<text x="6.6" y="9.1" font-size="3.9" font-weight="700" fill="${paint("#f3f0e8")}">Black Lotus Press</text>`,
    `<circle cx="55.6" cy="7.7" r="2.3" fill="${paint("#cfcac0")}"/>`,
    `<text x="55.6" y="8.85" font-size="3.2" font-weight="700" text-anchor="middle" fill="${paint("#1b1b1b")}">0</text>`,
    `<rect x="5.4" y="12.4" width="52.2" height="33.6" fill="${paint("#14101a")}" stroke="${paint("#555555")}" stroke-width="0.3"/>`,
    `<circle cx="31.5" cy="34" r="16" fill="${paint("#ec008c")}" opacity="0.32"/>`,
    `<circle cx="31.5" cy="36" r="9" fill="${paint("#00aeef")}" opacity="0.22"/>`,
    `<g transform="translate(31.5 41.5)">${petals.join("")}<circle r="2.7" fill="${paint("#fff200")}"/></g>`,
    bar(47.4, 5.4),
    `<text x="6.6" y="51.15" font-size="2.7" font-weight="600" fill="${paint("#f3f0e8")}">Legendary Artifact — Printing Press</text>`,
    `<rect x="5.4" y="54.4" width="52.2" height="25.4" rx="0.8" fill="${paint("#ece7da")}"/>`,
    `<text x="7.6" y="60.6" font-size="3.3" font-weight="500" fill="${paint("#1d1b18")}">{T}: Print 55 cards.</text>`,
    `<text x="7.6" y="66.4" font-size="3" font-style="italic" fill="${paint("#4a4640")}">“Proxy them all.”</text>`,
    `<rect x="45.4" y="79.6" width="13.4" height="5.4" rx="1.2" fill="${paint("#34343a")}" stroke="${paint("#6a6a6a")}" stroke-width="0.3"/>`,
    `<text x="52.1" y="83.5" font-size="3.4" font-weight="700" text-anchor="middle" fill="${paint("#f3f0e8")}">55/55</text>`,
    `<text x="5" y="86" font-size="1.5" fill="${paint("#8a8a8a")}">BLP · 055/055</text>`,
  ].join("");
}
const LAYERS = [["Y"], ["Y", "M"], ["Y", "M", "C"], ["Y", "M", "C", "K"]];

// The graded slab the finished card goes into, drawn face-on in the card's own millimetres.
const SLAB = { x: -11, y: -40, w: 85, h: 138, r: 4 };
const SLAB_LABEL = { x: -6, y: -35.5, w: 75, h: 22.5 };
const SLAB_SVG = (() => {
  const { x, y, w, h } = SLAB_LABEL;
  const bars = [];
  let at = x + 3;
  for (const width of [0.5, 0.25, 0.25, 0.75, 0.25, 0.5, 0.25, 0.25, 0.5, 0.75, 0.25, 0.5, 0.25, 0.75, 0.25, 0.25, 0.5, 0.25, 0.5, 0.75, 0.25, 0.5, 0.25, 0.25, 0.75, 0.5, 0.25, 0.5]) {
    bars.push(`<rect x="${f2(at)}" y="${y + 15.4}" width="${width}" height="3.6"/>`);
    at += width + 0.42;
  }
  const back = [
    `<rect class="slab-case" x="${SLAB.x}" y="${SLAB.y}" width="${SLAB.w}" height="${SLAB.h}" rx="${SLAB.r}"/>`,
    `<rect class="slab-well" x="-3.2" y="-3.2" width="69.4" height="94.4" rx="3.6"/>`,
    `<g class="slab-label">`,
    `<rect class="slab-label-paper" x="${x}" y="${y}" width="${w}" height="${h}" rx="0.8"/>`,
    `<rect class="slab-label-frame" x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="0.5"/>`,
    `<text x="${x + 3}" y="${y + 5.6}" font-size="2.7" font-weight="700">2026 BLACK LOTUS PRESS</text>`,
    `<text x="${x + 3}" y="${y + 9.2}" font-size="2.7" font-weight="500">LEGENDARY ARTIFACT</text>`,
    `<text x="${x + 3}" y="${y + 12.8}" font-size="2.7" font-weight="500">PRINTING PRESS #55</text>`,
    `<g class="slab-barcode">${bars.join("")}</g>`,
    `<text x="${x + 3}" y="${y + 21}" font-size="1.7" font-weight="500" letter-spacing="0.2">5505 5055</text>`,
    `<rect class="slab-logo" x="${x + 33}" y="${y + 3}" width="11" height="5" rx="1"/>`,
    `<text class="slab-logo-text" x="${x + 38.5}" y="${y + 6.75}" font-size="3.6" font-weight="700" font-style="italic" text-anchor="middle">PSA</text>`,
    `<g data-press="grade">`,
    `<text x="${x + w - 3}" y="${y + 6.2}" font-size="2.8" font-weight="700" text-anchor="end">GEM MT</text>`,
    `<text class="slab-grade" x="${x + w - 3}" y="${y + 18.6}" font-size="12" font-weight="700" text-anchor="end">10</text>`,
    `</g>`,
    `</g>`,
  ].join("");
  const front = [
    `<rect class="slab-ridge" x="-5.2" y="-5.2" width="73.4" height="98.4" rx="4.8"/>`,
    `<rect class="slab-ridge" x="-3.2" y="-3.2" width="69.4" height="94.4" rx="3.6"/>`,
    `<rect class="slab-ridge" x="${SLAB_LABEL.x - 1.6}" y="${SLAB_LABEL.y - 1.6}" width="${SLAB_LABEL.w + 3.2}" height="${SLAB_LABEL.h + 3.2}" rx="1.6"/>`,
    `<rect class="slab-cover" x="${SLAB.x}" y="${SLAB.y}" width="${SLAB.w}" height="${SLAB.h}" rx="${SLAB.r}" fill="url(#press-cover)"/>`,
    `<rect class="slab-bevel" x="${SLAB.x + 1.4}" y="${SLAB.y + 1.4}" width="${SLAB.w - 2.8}" height="${SLAB.h - 2.8}" rx="${SLAB.r - 1}"/>`,
    `<rect class="slab-edge" x="${SLAB.x}" y="${SLAB.y}" width="${SLAB.w}" height="${SLAB.h}" rx="${SLAB.r}"/>`,
    `<g clip-path="url(#press-slab-clip)"><rect data-press="shine" x="-80" y="-70" width="34" height="200" fill="url(#press-shine)" transform="skewX(-18)"/></g>`,
  ].join("");
  return { back, front };
})();

const CARD_SVG = (() => {
  const plan = cardPlan(HOPPER.cx);
  const body = S(k.slabOf(plan, ZC, CARD.T, P, 3), { tone: "hi", crease: "none", className: "press-paper" });
  const clips = [...LAYERS, ["O"]].map((_, i) => `<clipPath id="press-print-${i}"><rect data-press="print" width="63" height="0"/></clipPath>`).join("");
  const layers = LAYERS.map((inks, i) => `<g clip-path="url(#press-print-${i})">${heroFace((c) => inked(c, inks))}</g>`).join("");
  return [
    `<g data-press="card">`,
    `<defs>${clips}<clipPath id="press-slab-clip"><rect x="${SLAB.x}" y="${SLAB.y}" width="${SLAB.w}" height="${SLAB.h}" rx="${SLAB.r}"/></clipPath>`,
    `<linearGradient id="press-gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.08"/></linearGradient>`,
    `<linearGradient id="press-cover" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.1"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.02"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.06"/></linearGradient>`,
    `<linearGradient id="press-shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`,
    `<g data-press="card-body">${body}</g>`,
    `<g data-press="card-face" class="splash-hero" transform="${faceMatrix(HOPPER.cx, FACE_Z)}">`,
    `<rect width="63" height="88" rx="2.6" fill="${toHex(PAPER)}"/>`,
    layers,
    `<g clip-path="url(#press-print-4)"><rect width="63" height="88" rx="2.6" fill="url(#press-gloss)"/></g>`,
    `</g>`,
    `</g>`,
  ].join("");
})();
put("card", CARD_SVG, [slabShape(cardPlan(HOPPER.cx), ZC, CARD.T)], { key: CARD_SLOT });

R.items.sort((a, b) => a.key - b.key);
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

const LABEL = "A card printer seen from above: blank cards wait in the hopper, pass a cleaning roller and run under a thermal print head five times while a ribbon of yellow, magenta, cyan, black and overlay panels winds from spool to spool, then leave over the exit rollers onto the output stack. A counter on the console reads 54 of 55, then 55 of 55, and the finished card is sealed in a graded slab marked GEM MT 10.";
const SVG = k.figureSvg({ width: W, height: H, label: LABEL, className: "press", body: [
    `<g data-press="machine">`, HALO, ...R.items.map((item) => item.svg), `</g>`,
    // Outside the machine: the page puts the flying card between these two.
    `<g data-press="slab-back" opacity="0">${SLAB_SVG.back}</g>`,
    `<g data-press="slab-front" opacity="0">${SLAB_SVG.front}</g>`,
  ] });

const cam = A.cameraBasis(P);
const DATA = {
  view: [W, H],
  P: { origin: P.origin.map(f3), scale: f3(P.scale), azimuth: P.azimuth, elevation: P.elevation },
  card: { ...CARD, z: ZC, hopper: HOPPER.cx, start: START_CX, outX: OUT_STACK.cx, outTop: OUT_STACK.top, nip: PAIRS[1] + CARD.L / 2 },
  lift: LIFT,
  inks: INKS,
  ribbon: { sections: RIBBON, s: RIBBON_S, half: RIBBON_HALF, head: RIBBON_HEAD, ...PANEL },
  spins: SPINS,
  spools: { supply: SUPPLY.r, takeup: TAKEUP.r },
  belt: { ratio: 4 / ROLL_R },
  camera: { right: cam.R.map(f3), down: cam.D.map(f3) },
  slab: { top: SLAB.y, height: SLAB.h, grade: [SLAB_LABEL.x + SLAB_LABEL.w - 10, SLAB_LABEL.y + 13] },
};
const ART = `// Generated by tools/press/build.mjs. Do not edit.
export const PRESS_SVG = ${JSON.stringify(SVG)};
export const PRESS = ${JSON.stringify(DATA)} as const;
`;
writeFileSync(join(OUT, "art.ts"), ART);
writeFileSync(join(OUT, "iso.css"), `/* Generated by tools/press/build.mjs from the Anatomy kit (tools/anatomy, MIT). */\n${k.ISO_CSS.trim()}\n`);
console.log(`press: ${R.items.length} items, ${R.solids.length} solids, ${(SVG.length / 1024).toFixed(0)} KB svg`);

// The website has no build step, so its hero gets the art and the motion as one plain module.
const MOTION = transformSync(readFileSync(join(OUT, "motion.ts"), "utf8").replace(/^import .*$/gm, ""), { loader: "ts", format: "esm" }).code;
const SITE = join(ROOT, "site");
writeFileSync(join(SITE, "press.js"), `// Generated by tools/press/build.mjs. Do not edit.
export const PRESS_SVG = ${JSON.stringify(SVG)};
export const PRESS = ${JSON.stringify(DATA)};
${MOTION}`);
writeFileSync(join(SITE, "press.css"), `/* Generated by tools/press/build.mjs from the Anatomy kit (tools/anatomy, MIT). */\n${k.ISO_CSS.trim()}\n${readFileSync(join(OUT, "press.css"), "utf8")}`);

const previewAt = process.argv.indexOf("--preview");
if (previewAt > 0) {
  const target = resolve(process.argv[previewAt + 1]);
  const motion = MOTION.replace(/^export /gm, "");
  const font = (weight) => `@font-face{font-family:"Barlow Semi Condensed";font-weight:${weight};src:url("${join(ROOT, `node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-${weight}-normal.woff2`)}") format("woff2")}`;
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Press preview</title><style>${[400, 500, 600, 700].map(font).join("")}${k.ISO_CSS}${readFileSync(join(OUT, "press.css"), "utf8")}${readFileSync(join(OUT, "..", "splash.css"), "utf8")}
body{margin:0;font-family:"Barlow Semi Condensed",system-ui,sans-serif}.iso-plate{all:unset}</style></head>
<body><div class="splash iso"><div class="splash-figure">${SVG}</div></div>
<script type="module">const PRESS=${JSON.stringify(DATA)};\n${motion}\nconst speed=Number(new URLSearchParams(location.search).get("speed")||1);const at=Number(new URLSearchParams(location.search).get("t")||-1);
window.press=runPress(document.querySelector("svg.press"),PRESS,{speed,at});</script></body></html>`;
  writeFileSync(target, page);
  console.log("preview:", target);
}

// The head cable ends in a plug that sits on the arm.
A.auditOrExit(R, P, { crowd: [["cable.head", "head.arm"]] });
