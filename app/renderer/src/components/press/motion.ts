import type { PRESS } from "./art.js";

type Press = typeof PRESS;
type Vec = readonly [number, number, number];

// Seconds. Card 55 is picked, printed in five passes (one per ribbon panel), ejected onto the
// output stack, lifted off it and turned to face the viewer, then sealed in a graded slab.
const PICK = [0.15, 0.6] as const;
const PASS_AT = 0.68;
const PASS = 0.46;
const DOWN = 0.04;
const FORWARD = 0.26;
const UP = 0.04;
const BACK = PASS - DOWN - FORWARD - UP;
const EJECT_AT = PASS_AT + 4 * PASS + DOWN + FORWARD + UP;
const EJECT = 0.55;
const LANDED = EJECT_AT + EJECT;
const LIFT_AT = LANDED + 0.1;
const LIFT = 0.3;
const FLY_AT = LIFT_AT + LIFT;
const FLY = 0.7;
const SLAB_AT = FLY_AT + FLY;
const SLAB = 0.35;
const COVER_AT = SLAB_AT + 0.25;
const COVER = 0.3;
const GRADE_AT = COVER_AT + COVER;
const GRADE = 0.3;
const SHINE_AT = GRADE_AT + GRADE - 0.05;
const SHINE = 0.7;
export const PRESS_END = SHINE_AT + SHINE;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
    const t = clamp01(v);
    return t * t * (3 - 2 * t);
};
const ease = (v: number) => {
    const t = clamp01(v);
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
const settle = (v: number) => {
    const t = clamp01(v) - 1;
    return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function cardPose(press: Press, t: number) {
    const { card } = press;
    if (t < PICK[0]) return { cx: card.hopper, z: card.z };
    if (t < PASS_AT) return { cx: mix(card.hopper, card.start, ease((t - PICK[0]) / (PICK[1] - PICK[0]))), z: card.z };
    if (t < EJECT_AT) {
        const pass = Math.min(4, Math.floor((t - PASS_AT) / PASS));
        const local = t - PASS_AT - pass * PASS;
        let cx = card.start;
        if (local >= DOWN + FORWARD + UP && pass < 4) cx = card.start + card.L * (1 - ease((local - DOWN - FORWARD - UP) / BACK));
        else if (local >= DOWN) cx = card.start + card.L * smooth((local - DOWN) / FORWARD);
        return { cx, z: card.z };
    }
    const cx = mix(card.start + card.L, card.outX, ease((t - EJECT_AT) / EJECT));
    const z = card.z - (card.z - card.outTop) * smooth((cx - card.nip) / (card.outX - card.nip));
    return { cx, z: t < LIFT_AT ? z : z + 10 * ease((t - LIFT_AT) / LIFT) };
}

// How much of each pass has been printed, in millimetres from the card's leading edge.
function printed(press: Press, t: number, pass: number) {
    const start = PASS_AT + pass * PASS + DOWN;
    return press.card.L * (t < start + FORWARD ? (t < start ? 0 : smooth((t - start) / FORWARD)) : 1);
}

function ribbonOffset(press: Press, t: number) {
    const { pitch } = press.ribbon;
    const L = press.card.L;
    if (t < PASS_AT) return 0;
    const pass = Math.min(4, Math.floor((t - PASS_AT) / PASS));
    const local = t - PASS_AT - pass * PASS;
    if (local < DOWN) return pass * pitch;
    if (local < DOWN + FORWARD) return pass * pitch + L * smooth((local - DOWN) / FORWARD);
    return pass * pitch + L + (pitch - L) * ease((local - DOWN - FORWARD - UP) / BACK);
}

function headLift(press: Press, t: number) {
    if (t < PASS_AT || t >= EJECT_AT) return press.lift;
    const local = (t - PASS_AT) % PASS;
    if (local < DOWN) return press.lift * (1 - smooth(local / DOWN));
    if (local < DOWN + FORWARD) return 0;
    return press.lift * smooth((local - DOWN - FORWARD) / UP);
}

export interface PressOptions {
    speed?: number;
    // Hold the figure at this time (seconds) instead of running, for screenshots.
    at?: number;
}

// Runs the printer once and returns a function that stops it.
export function runPress(svg: SVGSVGElement, press: Press, { speed = 1, at = -1 }: PressOptions = {}) {
    const { P } = press;
    const rad = Math.PI / 180;
    const sinA = Math.sin(P.azimuth * rad);
    const cosA = Math.cos(P.azimuth * rad);
    const sinE = Math.sin(P.elevation * rad);
    const cosE = Math.cos(P.elevation * rad);
    const kk = P.scale * Math.sqrt(1.6);
    const vec = ([x, y, z]: Vec): [number, number] => [(x * sinA - y * cosA) * kk, ((x * cosA + y * sinA) * sinE - z * cosE) * kk];
    const iso = (p: Vec): [number, number] => {
        const [x, y] = vec(p);
        return [P.origin[0] + x, P.origin[1] + y];
    };
    const fix = (n: number) => Math.round(n * 100) / 100;
    const line = (points: [number, number][], closed = false) =>
        points.map(([x, y], i) => `${i ? 'L' : 'M'}${fix(x)} ${fix(y)}`).join('') + (closed ? 'Z' : '');

    const find = <T extends Element>(selector: string) => svg.querySelector<T>(selector)!;
    const cardGroup = find<SVGGElement>('[data-press="card"]');
    const cardBody = find<SVGGElement>('[data-press="card-body"]');
    const cardFace = find<SVGGElement>('[data-press="card-face"]');
    const prints = [...svg.querySelectorAll<SVGRectElement>('[data-press="print"]')];
    const shine = find<SVGRectElement>('[data-press="shine"]');
    const slabBack = find<SVGGElement>('[data-press="slab-back"]');
    const slabFront = find<SVGGElement>('[data-press="slab-front"]');
    const grade = find<SVGGElement>('[data-press="grade"]');
    const head = find<SVGGElement>('[data-press="head"]');
    const heat = find<SVGPathElement>('[data-press="heat"]');
    const teeth = find<SVGPathElement>('[data-press="teeth"]');
    const count = find<SVGTextElement>('[data-press="count"]');
    const led = find<SVGCircleElement>('[data-press="led"]');
    const inkLights = [...svg.querySelectorAll<SVGRectElement>('.press-ink')];
    const spins = [...svg.querySelectorAll<SVGPathElement>('[data-spin]')];
    const ribbons = [...svg.querySelectorAll<SVGGElement>('[data-press="ribbon"]')].map((group) =>
        press.inks.map((ink) => group.querySelector<SVGPathElement>(`.press-panel[data-ink="${ink}"]`)!));

    const faceU = vec([0, 1, 0]);
    const faceV = vec([-1, 0, 0]);
    const { card, ribbon } = press;
    const [w, h] = press.view;

    // The turn from lying flat to facing the viewer, as an axis and an angle.
    const a0: Vec = [0, 1, 0];
    const b0: Vec = [-1, 0, 0];
    const turn = (() => {
        const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const m0 = [a0, b0, cross(a0, b0)];
        const a1 = press.camera.right as unknown as Vec;
        const b1 = press.camera.down as unknown as Vec;
        const m1 = [a1, b1, cross(a1, b1)];
        const q = (r: number, c: number) => m1[0]![r]! * m0[0]![c]! + m1[1]![r]! * m0[1]![c]! + m1[2]![r]! * m0[2]![c]!;
        const angle = Math.acos(Math.min(1, Math.max(-1, (q(0, 0) + q(1, 1) + q(2, 2) - 1) / 2)));
        const axis: Vec = [q(2, 1) - q(1, 2), q(0, 2) - q(2, 0), q(1, 0) - q(0, 1)];
        const length = Math.hypot(...axis);
        return { angle, axis: axis.map((v) => v / length) as unknown as Vec };
    })();
    const rotate = (v: Vec, angle: number): Vec => {
        const [x, y, z] = turn.axis;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const dot = x * v[0] + y * v[1] + z * v[2];
        return [
            v[0] * c + (y * v[2] - z * v[1]) * s + x * dot * (1 - c),
            v[1] * c + (z * v[0] - x * v[2]) * s + y * dot * (1 - c),
            v[2] * c + (x * v[1] - y * v[0]) * s + z * dot * (1 - c),
        ];
    };
    // At the end the whole slab fills most of the height, centred.
    const { slab } = press;
    const finalScale = (h * 0.86) / (slab.height * kk);
    const slabMid = slab.top + slab.height / 2;
    const about = (x: number, y: number, scale: number) => `translate(${x} ${y}) scale(${fix(scale)}) translate(${-x} ${-y})`;

    let lifted = false;
    function draw(t: number) {
        const pose = cardPose(press, t);
        const travel = pose.cx - card.hopper;
        const offset = ribbonOffset(press, t);

        if (t < FLY_AT) {
            const [dx, dy] = vec([travel, 0, pose.z - card.z]);
            cardBody.setAttribute('transform', `translate(${fix(dx)} ${fix(dy)})`);
            const [ox, oy] = iso([pose.cx + card.L / 2, -card.W / 2, pose.z + card.T]);
            cardFace.setAttribute('transform', `matrix(${faceU[0]} ${faceU[1]} ${faceV[0]} ${faceV[1]} ${fix(ox)} ${fix(oy)})`);
        } else {
            if (!lifted) {
                lifted = true;
                cardBody.style.display = 'none';
                cardGroup.classList.add('flying');
                svg.appendChild(cardGroup);
                svg.appendChild(slabFront);
                svg.classList.add('hero');
            }
            const u = ease((t - FLY_AT) / FLY);
            const right = vec(rotate(a0, turn.angle * u));
            const down = vec(rotate(b0, turn.angle * u));
            const scale = mix(1, finalScale, u);
            const from = iso([card.outX, 0, card.outTop + 10 + card.T]);
            const cx = mix(from[0], w / 2, u);
            const cy = mix(from[1], h / 2 + (card.L / 2 - slabMid) * kk * finalScale, u);
            const m = [right[0] * scale, right[1] * scale, down[0] * scale, down[1] * scale];
            const ox = cx - m[0]! * card.W / 2 - m[2]! * card.L / 2;
            const oy = cy - m[1]! * card.W / 2 - m[3]! * card.L / 2;
            const matrix = `matrix(${m.map((v) => Math.round(v * 1000) / 1000).join(' ')} ${fix(ox)} ${fix(oy)})`;
            cardFace.setAttribute('transform', matrix);
            slabBack.setAttribute('transform', `${matrix} translate(0 ${fix(14 * (1 - ease((t - SLAB_AT) / SLAB)))})`);
            slabFront.setAttribute('transform', `${matrix} ${about(card.W / 2, slabMid, mix(1.12, 1, settle((t - COVER_AT) / COVER)))}`);
        }

        prints.forEach((rect, pass) => rect.setAttribute('height', String(fix(printed(press, t, pass)))));
        slabBack.setAttribute('opacity', String(fix(smooth((t - SLAB_AT) / SLAB))));
        slabFront.setAttribute('opacity', String(fix(smooth((t - COVER_AT) / (COVER * 0.6)))));
        grade.setAttribute('opacity', String(fix(smooth((t - GRADE_AT) / (GRADE * 0.4)))));
        grade.setAttribute('transform', about(slab.grade[0], slab.grade[1], mix(2.4, 1, settle((t - GRADE_AT) / GRADE))));
        shine.setAttribute('x', String(fix(mix(-80, 110, ease((t - SHINE_AT) / SHINE)))));

        const lift = headLift(press, t);
        const [hx, hy] = vec([0, 0, lift]);
        head.setAttribute('transform', `translate(${fix(hx)} ${fix(hy)})`);
        const heating = lift === 0 && t >= PASS_AT && t < EJECT_AT;
        heat.toggleAttribute('data-on', heating);
        led.toggleAttribute('data-on', t >= PICK[0] && t < LANDED);

        const pass = t < PASS_AT ? -1 : t < EJECT_AT ? Math.floor((t - PASS_AT) / PASS) : 5;
        inkLights.forEach((light, i) => {
            light.toggleAttribute('data-done', i < pass);
            light.toggleAttribute('data-on', i === pass);
        });
        const text = t >= LANDED ? '55/55' : '54/55';
        if (count.textContent !== text) count.textContent = text;

        for (const path of spins) {
            const spin = press.spins[Number(path.dataset.spin)]!;
            const angle = spin.drive === 'card' ? travel * spin.ratio : -offset * spin.ratio;
            const marks: string[] = [];
            for (let i = 0; i < spin.count; i++) {
                const a = angle + (i * Math.PI * 2) / spin.count;
                const c = Math.cos(a);
                const s = Math.sin(a);
                marks.push(line([iso([spin.x + c * spin.r0, spin.y, spin.z + s * spin.r0]), iso([spin.x + c * spin.r1, spin.y, spin.z + s * spin.r1])]));
            }
            path.setAttribute('d', marks.join(''));
        }
        teeth.style.strokeDashoffset = String(fix(-travel * press.belt.ratio * kk));

        ribbon.sections.forEach(([a, b], i) => {
            const [s0, s1] = ribbon.s[i]!;
            const paths = press.inks.map(() => '');
            const pointAt = (s: number) => {
                const f = (s - s0) / (s1 - s0);
                return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] as const;
            };
            const first = Math.ceil((ribbon.head + offset - ribbon.length - s1) / ribbon.pitch);
            const last = Math.floor((ribbon.head + offset - s0) / ribbon.pitch);
            for (let j = first; j <= last; j++) {
                const hi = Math.min(s1, ribbon.head + offset - j * ribbon.pitch);
                const lo = Math.max(s0, ribbon.head + offset - j * ribbon.pitch - ribbon.length);
                if (hi <= lo) continue;
                const [x0, z0] = pointAt(lo);
                const [x1, z1] = pointAt(hi);
                const ink = ((j % 5) + 5) % 5;
                paths[ink] += line([iso([x0, -ribbon.half, z0]), iso([x1, -ribbon.half, z1]), iso([x1, ribbon.half, z1]), iso([x0, ribbon.half, z0])], true);
            }
            ribbons[i]!.forEach((path, ink) => path.setAttribute('d', paths[ink]!));
        });
    }

    if (at >= 0) {
        draw(at);
        return () => {};
    }
    let frame = 0;
    let started = 0;
    const tick = (now: number) => {
        started ||= now;
        const t = ((now - started) / 1000) * speed;
        draw(Math.min(t, PRESS_END));
        frame = t < PRESS_END ? requestAnimationFrame(tick) : 0;
    };
    draw(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
}
