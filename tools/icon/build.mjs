// Builds the app icon from the Anatomy kit: build/icon.svg, build/icon.png (1024 px, electron-builder makes
// the .icns and .ico from it) and the website's site/img/icon-256.png and icon-64.png.
// Renders with Playwright in the installed Google Chrome.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import * as k from "../anatomy/iso-kit.mjs";
import * as G from "../anatomy/lathe.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIZE = 1024;

// World units are millimetres: x along the printer, y from back to front, z up.
// The card leaves through a slot in the lid, face to the front, top edge first.
const CARD = { L: 88, W: 63, T: 1.2, R: 3 };
const OUT = 70;
const BODY = { x: -52, y: -30, w: 104, d: 60, r: 7 };
const BODY_H = 44;
const LID_Z = 30;
const FRONT = BODY.y + BODY.d;
const RIGHT = BODY.x + BODY.w;
const SLOT = { x: -36, y: -3.5, w: 72, d: 7, r: 3.5 };
const LIP = { x: -40, y: -7, w: 80, d: 14, r: 6 };
const LIP_H = 3;
const TOP = BODY_H + LIP_H;
const CARD_TOP = TOP + OUT;

const P = k.fitProjection(
  [...k.boxCorners(BODY, -4, BODY_H), [-CARD.W / 2, 0, CARD_TOP], [CARD.W / 2, 0, CARD_TOP]],
  SIZE,
  SIZE,
  { pad: 200, azimuth: 56, elevation: 28 },
);
const at = (point) => k.iso(point, P);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, { size: 3.2, ...style });
const ACROSS = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
const box = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const onFront = (x, z, y = FRONT) => [x, y, z];
const circleOnFront = (x, z, r, y = FRONT, steps = 18) => path3(Array.from({ length: steps }, (_, i) => onFront(x + Math.cos((i / steps) * Math.PI * 2) * r, z + Math.sin((i / steps) * Math.PI * 2) * r, y)), true);
const rect = (x0, z0, x1, z1, y) => path3([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], true);

const parts = [];
const halo = `<path class="iso-halo" d="${k.haloOf(BODY, -4, BODY_H, P)}"/>`;

// ---------- feet ----------
for (const [x, y] of k.corners(BODY, 12)) parts.push(S(k.cylinder(x, y, 5.5, -4, 4, P, 28), { tone: "lo" }));

// ---------- case: lid seam, screws, vents on the end ----------
{
  const screws = k.corners(BODY, 6.5);
  const frontScrews = [[-46, 7], [46, 7], [-46, LID_Z + 8], [46, LID_Z + 8]];
  const vents = Array.from({ length: 6 }, (_, i) => {
    const y = -19 + i * 7;
    return path3([[RIGHT, y, 38], [RIGHT, y + 3, 38], [RIGHT, y + 3, 33], [RIGHT, y, 33]], true);
  }).join("");
  const extra = [
    Ln(k.planOutline(k.insetPlan(BODY, 3.5), BODY_H, P), { tone: "faint" }),
    Ln(screws.map(([x, y]) => k.ring(x, y, 3, BODY_H, P, 18)).join(""), { tone: "lo" }),
    Dots(screws.map(([x, y]) => at([x, y, BODY_H])), { tone: "hi" }),
    Ln(frontScrews.map(([x, z]) => circleOnFront(x, z, 2.6)).join(""), { tone: "lo" }),
    Dots(frontScrews.map(([x, z]) => at(onFront(x, z))), { tone: "mid" }),
    Ln(vents, { tone: "lo" }),
  ].join("");
  parts.push(S(k.slabOf(BODY, 0, BODY_H, P, 8, 2.2), { tone: "mid", inner: Ln(k.sideSeam(BODY, LID_Z, P), { tone: "lo" }) }) + extra);
}

// ---------- front: ribbon window, counter, power light, label plate ----------
{
  const face = FRONT + 1.6;
  const win = { x0: -42, x1: 8, z0: 9, z1: 23 };
  parts.push(S(G.prismOf(ACROSS, box(win.x0 - 3, win.z0 - 3, win.x1 + 3, win.z1 + 3), FRONT, face, P), { tone: "lo" }));
  // The yellow, magenta, cyan and black panels of the ribbon behind the glass.
  const gap = 1.2;
  const width = (win.x1 - win.x0 - 3 * gap) / 4;
  const panels = ["Y", "M", "C", "K"].map((ink, i) => {
    const x0 = win.x0 + i * (width + gap);
    return `<path class="icon-ink" data-ink="${ink}" d="${rect(x0, win.z0, x0 + width, win.z1, face)}"/>`;
  }).join("");
  const glass = rect(win.x0, win.z0, win.x1, win.z1, face);
  parts.push(`<path class="icon-dark" d="${glass}"/>${panels}<path class="icon-film" d="${glass}"/>` + Ln(glass, { tone: "lo" }) + Ln(path3([[win.x0 + 4, face, win.z1 - 1.6], [win.x0 + 15, face, win.z1 - 1.6]]), { tone: "hi", free: true }));

  const lcd = { x0: 16, x1: 42, z0: 12, z1: 23 };
  parts.push(S(G.prismOf(ACROSS, box(lcd.x0 - 2.5, lcd.z0 - 2.5, lcd.x1 + 2.5, lcd.z1 + 2.5), FRONT, face, P), { tone: "lo" }));
  const screen = rect(lcd.x0, lcd.z0, lcd.x1, lcd.z1, face);
  parts.push(
    `<path class="icon-dark" d="${screen}"/>` +
      `<g transform="${k.sideMatrix([lcd.x0 + 2.4, face], lcd.z1 - 2, P, "left")}"><text class="icon-lcd" y="7" font-size="7.4">55/55</text></g>` +
      Ln(screen, { tone: "lo" }),
  );
  parts.push(S(G.disc(FRONT, FRONT + 1.4, 1.8, G.frameOf([46, 0, 20], [0, 1, 0], [1, 0, 0], [0, 0, 1]), P), { tone: "hi", lit: true }));

  const label = { x0: 16, x1: 42, z0: 32, z1: 39 };
  parts.push(
    S(G.prismOf(ACROSS, box(label.x0, label.z0, label.x1, label.z1), FRONT, FRONT + 0.6, P), { tone: "lo", crease: "none" }) +
      `<g transform="${k.sideMatrix([label.x0 + 2, FRONT + 0.6], label.z1 - 1.6, P, "left")}"><text class="icon-label" y="3.6" font-size="3.9">BLP-55</text></g>` +
      Dots([at(onFront(label.x0 + 1.2, label.z0 + 1.2, FRONT + 0.6)), at(onFront(label.x1 - 1.2, label.z0 + 1.2, FRONT + 0.6))], { size: 2, tone: "mid" }),
  );
}

// ---------- lid: the slot lip and the ribbon knob ----------
{
  parts.push(
    S(k.slabOf(LIP, BODY_H, LIP_H, P, 8, 0.8), { tone: "mid" }) +
      `<path class="icon-dark" d="${k.planOutline(SLOT, TOP, P)}"/>` +
      Ln(k.planOutline(SLOT, TOP, P), { tone: "lo" }) +
      Dots([[LIP.x + 3.5, 0], [LIP.x + LIP.w - 3.5, 0]].map(([x, y]) => at([x, y, TOP])), { size: 2.4, tone: "mid" }),
  );
  const knob = { x: 38, y: -18 };
  const knobTop = BODY_H + 9;
  parts.push(
    S(k.cylinder(knob.x, knob.y, 8, BODY_H, 2, P, 32), { tone: "lo" }) +
      S(k.cylinder(knob.x, knob.y, 6, BODY_H + 2, 7, P, 32), { tone: "mid" }) +
      Ln(k.knurl(knob.x, knob.y, 6, BODY_H + 2, knobTop, 36, P), { tone: "lo" }) +
      Dots([at([knob.x, knob.y, knobTop])], { tone: "hi" }),
  );
}

// ---------- the printed card, rising out of the slot ----------
{
  const r = CARD.R;
  const corner = (cx, cz, from) => Array.from({ length: 7 }, (_, i) => {
    const a = from + (i / 6) * (Math.PI / 2);
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  });
  const x0 = -CARD.W / 2;
  const x1 = CARD.W / 2;
  const outline = [[x0, TOP], [x1, TOP], ...corner(x1 - r, CARD_TOP - r, 0), ...corner(x0 + r, CARD_TOP - r, Math.PI / 2)];
  const face = CARD.T / 2;
  parts.push(
    S(G.prismOf(ACROSS, outline, -face, face, P), { tone: "hi", crease: "none", className: "icon-paper" }) +
      `<defs><clipPath id="icon-out"><rect width="${CARD.W}" height="${OUT}"/></clipPath></defs>` +
      `<g transform="${k.sideMatrix([x0, face], CARD_TOP, P, "left")}" clip-path="url(#icon-out)">${lotusFace()}</g>`,
  );
}

// The Black Lotus Press card in card-local millimetres (63 × 88, origin top left).
function lotusFace() {
  const petals = [-72, -36, 0, 36, 72].map((angle) => `<path d="M0 0C-6 -9.4 -5.4 -19.6 0 -25.6C5.4 -19.6 6 -9.4 0 0Z" transform="rotate(${angle})"/>`).join("");
  const bar = (y, h) => `<rect x="4.2" y="${y}" width="54.6" height="${h}" rx="${h / 2}" fill="#34343a" stroke="#6a6a6a" stroke-width="0.3"/>`;
  return [
    `<rect width="63" height="88" rx="3" fill="#0c0c0c"/>`,
    `<rect x="2.6" y="2.6" width="57.8" height="82.8" rx="1.6" fill="#202024"/>`,
    bar(4.4, 6.6),
    `<text class="icon-card-text" x="6.6" y="9.1" font-size="3.9" font-weight="700" fill="#f3f0e8">Black Lotus Press</text>`,
    `<circle cx="55.6" cy="7.7" r="2.3" fill="#cfcac0"/>`,
    `<text class="icon-card-text" x="55.6" y="8.85" font-size="3.2" font-weight="700" text-anchor="middle" fill="#1b1b1b">0</text>`,
    `<clipPath id="icon-art-window"><rect x="5.4" y="12.4" width="52.2" height="33.6"/></clipPath>`,
    `<g clip-path="url(#icon-art-window)">`,
    `<rect x="5.4" y="12.4" width="52.2" height="33.6" fill="#14101a"/>`,
    `<circle cx="31.5" cy="33" r="16" fill="#ec008c" opacity="0.4"/>`,
    `<circle cx="31.5" cy="36" r="9" fill="#00aeef" opacity="0.28"/>`,
    `<g transform="translate(31.5 42.5)" fill="#4a3266" stroke="#dcaef5" stroke-width="0.55" stroke-linejoin="round">${petals}<circle r="3" fill="#fff200" stroke="none"/></g>`,
    `</g>`,
    `<rect x="5.4" y="12.4" width="52.2" height="33.6" fill="none" stroke="#555555" stroke-width="0.3"/>`,
    bar(47.4, 5.4),
    `<text class="icon-card-text" x="6.6" y="51.15" font-size="2.7" font-weight="600" fill="#f3f0e8">Legendary Artifact — Printing Press</text>`,
    `<rect x="5.4" y="54.4" width="52.2" height="25.4" rx="0.8" fill="#ece7da"/>`,
    `<text class="icon-card-text" x="7.6" y="60.6" font-size="3.3" font-weight="500" fill="#1d1b18">{T}: Print 55 cards.</text>`,
    `<text class="icon-card-text" x="7.6" y="66.4" font-size="3" font-style="italic" fill="#4a4640">“Proxy them all.”</text>`,
  ].join("");
}

const CSS = `
.icon-art{--anatomy-paper:#1f1f22;--anatomy-top:#36363a;--anatomy-shade-0:#18181a;--anatomy-shade-1:#1e1e21;--anatomy-shade-2:#252528;--anatomy-shade-3:#2c2c30;
--anatomy-lit-top:#ffffff;--anatomy-lit-shade:#e8e8e8;--anatomy-hi:#ececec;--anatomy-mid:#8e8e93;--anatomy-lo:#5c5c61;--anatomy-faint:#424246;
--anatomy-weight:2.3px;--anatomy-dot:#f2f2f2;--anatomy-halo:#000;--anatomy-halo-opacity:1}
.icon-art .iso-halo{filter:blur(22px);transform:translateY(14px)}
.icon-paper>.iso-fill{fill:#d9d9d4}.icon-paper>.iso-top{fill:#f4f4f1}
.icon-paper>.iso-shade[data-shade="0"]{fill:#a9a9a4}.icon-paper>.iso-shade[data-shade="1"]{fill:#babab5}
.icon-paper>.iso-shade[data-shade="2"]{fill:#c8c8c3}.icon-paper>.iso-shade[data-shade="3"]{fill:#d6d6d1}
.icon-paper>.iso-line[data-tone="lo"]{stroke:#8f8f8a}
.icon-dark{fill:#08080a;stroke:none}
.icon-film{fill:#ffffff;opacity:0.06;stroke:none}
.icon-ink{stroke:none}.icon-ink[data-ink="Y"]{fill:#fff200}.icon-ink[data-ink="M"]{fill:#ec008c}.icon-ink[data-ink="C"]{fill:#00aeef}.icon-ink[data-ink="K"]{fill:#3a3536}
.icon-lcd{fill:#e6e6e6;font-family:var(--anatomy-mono);font-weight:600}
.icon-label{fill:var(--anatomy-mid);font-family:var(--anatomy-mono);letter-spacing:.04em}
.icon-card-text{font-family:"Barlow Semi Condensed",system-ui,sans-serif}
`;

// macOS icon grid: an 824 px plate with rounded corners and a soft shadow.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="iso iso-svg" data-theme="dark" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<style>${k.ISO_CSS}${CSS}</style>
<defs>
<linearGradient id="icon-plate" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1c1c1e"/><stop offset="1" stop-color="#0c0c0d"/></linearGradient>
<radialGradient id="icon-glow" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<filter id="icon-drop" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.45"/></filter>
</defs>
<!-- The shadow on its own: Chrome renders a filtered gradient in tiles, which shows as a band. -->
<rect x="100" y="100" width="824" height="824" rx="185" fill="#000" filter="url(#icon-drop)"/>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#icon-plate)"/>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#icon-glow)"/>
<rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="3"/>
<g class="icon-art">${halo}${parts.join("")}</g>
</svg>
`;
writeFileSync(join(ROOT, "build/icon.svg"), SVG);

const font = (weight) => `@font-face{font-family:"Barlow Semi Condensed";font-weight:${weight};src:url("file://${join(ROOT, `node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-${weight}-normal.woff2`)}") format("woff2")}`;
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  await page.setContent(`<!doctype html><style>${[500, 600, 700].map(font).join("")}html,body{margin:0;background:transparent}svg{display:block}</style>${SVG}`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ omitBackground: true });
  writeFileSync(join(ROOT, "build/icon.png"), png);
  for (const size of [256, 64]) await sharp(png).resize(size, size, { kernel: "lanczos3" }).png().toFile(join(ROOT, `site/img/icon-${size}.png`));
} finally {
  await browser.close();
}
console.log("icon: build/icon.svg, build/icon.png, site/img/icon-256.png, site/img/icon-64.png");
