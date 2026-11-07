// The hero card is printed in four halftone plates that sweep into register on a blank card, then tilts in the light like a foil.
const figure = document.querySelector('.hero-card');
const button = figure.querySelector('.press-card');
const tilt = figure.querySelector('.card-tilt');
const face = figure.querySelector('.card-face');
const headline = document.querySelector('.hero h1');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Screen angles and inks of the four plates, in the order they print.
const PLATES = [
    { angle: 15, color: '#00aeef', ink: (c, m, y, k) => c },
    { angle: 75, color: '#ec008c', ink: (c, m, y, k) => m },
    { angle: 0, color: '#fff200', ink: (c, m, y, k) => y },
    { angle: 45, color: '#231f20', ink: (c, m, y, k) => k }
];
const CELLS_ACROSS = 80;
// Part of the grey that goes to the black plate; the rest stays in the colours, which keeps them rich.
const BLACK = 0.7;

const plates = document.createElement('span');
plates.className = 'plates';
plates.setAttribute('aria-hidden', 'true');
const blank = document.createElement('span');
blank.className = 'blank';
plates.append(blank);
tilt.prepend(plates);

function drawPlates() {
    const width = tilt.clientWidth;
    const scale = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(width * scale);
    const h = Math.round(w * face.naturalHeight / face.naturalWidth);
    // One ink sample for every two pixels of the card on screen.
    const sw = Math.max(1, Math.round(width / 2));
    const sh = Math.max(1, Math.round(sw * face.naturalHeight / face.naturalWidth));
    const sampler = document.createElement('canvas');
    sampler.width = sw;
    sampler.height = sh;
    const sctx = sampler.getContext('2d', { willReadFrequently: true });
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, sw, sh);
    sctx.drawImage(face, 0, 0, sw, sh);
    const pixels = sctx.getImageData(0, 0, sw, sh).data;
    const inks = new Float32Array(sw * sh * 4);
    for (let i = 0; i < sw * sh; i++) {
        const r = pixels[i * 4] / 255, g = pixels[i * 4 + 1] / 255, b = pixels[i * 4 + 2] / 255;
        const k = (1 - Math.max(r, g, b)) * BLACK;
        inks.set([(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k], i * 4);
    }

    const cell = w / CELLS_ACROSS;
    for (const [index, plate] of PLATES.entries()) {
        const canvas = plates.children[index + 1] ?? plates.appendChild(document.createElement('canvas'));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = plate.color;
        ctx.beginPath();
        const cos = Math.cos(plate.angle * Math.PI / 180), sin = Math.sin(plate.angle * Math.PI / 180);
        const corners = [[0, 0], [w, 0], [0, h], [w, h]];
        const us = corners.map(([x, y]) => x * cos + y * sin), vs = corners.map(([x, y]) => -x * sin + y * cos);
        for (let i = Math.floor(Math.min(...us) / cell) - 1; i <= Math.max(...us) / cell; i++) {
            for (let j = Math.floor(Math.min(...vs) / cell) - 1; j <= Math.max(...vs) / cell; j++) {
                const u = (i + 0.5) * cell, v = (j + 0.5) * cell;
                const x = u * cos - v * sin, y = u * sin + v * cos;
                if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
                const at = (Math.min(sh - 1, Math.max(0, Math.floor(y / h * sh))) * sw + Math.min(sw - 1, Math.max(0, Math.floor(x / w * sw)))) * 4;
                const ink = Math.min(1, Math.max(0, plate.ink(inks[at], inks[at + 1], inks[at + 2], inks[at + 3])));
                if (ink < 0.03) continue;
                const radius = cell * Math.sqrt(ink / Math.PI) * 1.08;
                ctx.moveTo(x + radius, y);
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
            }
        }
        ctx.fill();
    }
}

// Plates fan out like a hand of cards, narrower on small screens so they stay on the page.
function fan(index) {
    const spread = Number(getComputedStyle(figure).getPropertyValue('--fan')) || 1;
    const position = index - (PLATES.length - 1) / 2;
    return `translate(${position * 6 * spread}%, ${Math.abs(position) * 3}%) rotate(${position * 8 * spread}deg)`;
}

let printing = false;
async function print() {
    if (printing) return;
    printing = true;
    figure.classList.remove('printed');
    const canvases = [...plates.querySelectorAll('canvas')];
    for (const canvas of canvases) canvas.getAnimations().forEach(animation => animation.cancel());
    headline.classList.add('misregistered');
    const dealt = canvases.map((canvas, index) => canvas.animate(
        [{ transform: `translateY(14%) scale(0.9)`, opacity: 0 }, { transform: fan(index), opacity: 1 }],
        { duration: 420, delay: 120 + index * 110, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' }
    ));
    await Promise.all(dealt.map(animation => animation.finished));
    headline.classList.remove('misregistered');
    const registered = canvases.map((canvas, index) => canvas.animate(
        [{ transform: fan(index) }, { transform: 'none' }],
        { duration: 900, delay: 450 + index * 130, easing: 'cubic-bezier(0.3, 1.3, 0.45, 1)', fill: 'both' }
    ));
    await Promise.all(registered.map(animation => animation.finished));
    figure.classList.add('printed');
    figure.querySelector('.foil').animate(
        [{ opacity: 0, '--glare-x': '-20%' }, { opacity: 1, offset: 0.3 }, { opacity: 0, '--glare-x': '120%' }],
        { duration: 1100, delay: 350, easing: 'ease-in-out' }
    );
    printing = false;
}

// Follows the pointer anywhere in the hero, and catches the light when it is on the card.
const target = { x: 0.5, y: 0.5 }, current = { x: 0.5, y: 0.5 };
let frame = 0;
function follow() {
    current.x += (target.x - current.x) * 0.12;
    current.y += (target.y - current.y) * 0.12;
    tilt.style.setProperty('--tilt-x', `${(0.5 - current.y) * 14}deg`);
    tilt.style.setProperty('--tilt-y', `${(current.x - 0.5) * 18}deg`);
    tilt.style.setProperty('--glare-x', `${current.x * 100}%`);
    tilt.style.setProperty('--glare-y', `${current.y * 100}%`);
    frame = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.001 ? requestAnimationFrame(follow) : 0;
}
function aim(x, y) {
    target.x = x;
    target.y = y;
    if (!frame) frame = requestAnimationFrame(follow);
}

async function start() {
    try {
        await face.decode();
        drawPlates();
    } catch {
        figure.classList.add('printed');
        return;
    }
    if (reduced) {
        figure.classList.add('printed');
    } else {
        // On small screens the card is below the fold; it prints once it is in view.
        await new Promise(resolve => new IntersectionObserver((entries, observer) => {
            if (!entries[0].isIntersecting) return;
            observer.disconnect();
            resolve();
        }, { threshold: 0.4 }).observe(figure));
        await print();
    }
    button.addEventListener('click', () => void print());
    if (reduced) return;
    const hero = figure.closest('.hero');
    hero.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse') return;
        const box = tilt.getBoundingClientRect();
        const clamp = value => Math.min(1.25, Math.max(-0.25, value));
        aim(clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height));
    });
    hero.addEventListener('pointerleave', () => aim(0.5, 0.5));
    let width = tilt.clientWidth;
    new ResizeObserver(() => {
        if (tilt.clientWidth === width) return;
        width = tilt.clientWidth;
        drawPlates();
    }).observe(tilt);
}

void start();
