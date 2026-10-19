import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type BrowserContext, chromium, type Page } from "playwright";
import type { Handover, HandoverStep, OnProgress, PlaywrightChannel } from "../model.js";

export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ShopWindow {
    context: BrowserContext;
    // The first window; more open with context.newPage(), at the same place.
    page: Page;
    handover(): Handover;
    update(change: (handover: Handover) => Handover): void;
    step(index: number, state: HandoverStep['state'], detail?: string, progress?: HandoverStep['progress']): void;
    // Marks the running step as failed and returns the error to pass on, which names a window the user closed as such.
    fail(error: unknown): unknown;
}

// The shop's window of the running hand-over, which the app can bring to the front.
let current: BrowserContext | undefined;

// The shop's pages in a window without tabs and address bar, where the app's window is, so it reads as part of the app.
// A bar from the app sits on every page; it shows the hand-over and points at what the user has to fill in.
export async function openShopWindow(channel: PlaywrightChannel, bounds: WindowBounds | undefined, handover: Handover,
                                     onProgress?: OnProgress, signal?: AbortSignal): Promise<ShopWindow> {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'black-lotus-press-browser-'));
    const placement = bounds ? [`--window-position=${bounds.x},${bounds.y}`, `--window-size=${bounds.width},${bounds.height}`] : [];
    const context = await chromium.launchPersistentContext(profile, {
        channel,
        headless: false,
        viewport: null,
        args: [`--app=${startPage(handover.title)}`, ...placement]
    });
    current = context;
    let closed = false;
    context.on('close', () => {
        closed = true;
        if (current === context) current = undefined;
        // Chrome may still be writing into it; a profile left behind in the temp folder is no reason to fail.
        fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
    });

    // Aborting closes the window, so the pending call fails right away.
    signal?.addEventListener('abort', () => void context.close(), { once: true });
    if (signal?.aborted) {
        await context.close();
        signal.throwIfAborted();
    }

    let state = handover;
    const update = (change: (handover: Handover) => Handover) => {
        state = change(state);
        onProgress?.({ type: 'handover', handover: state });
    };
    await context.exposeFunction('__blackLotusPress', () => state);
    await context.addInitScript(OVERLAY);
    update(same => same);

    const step = (index: number, stepState: HandoverStep['state'], detail?: string, progress?: HandoverStep['progress']) => update(handover => ({
        ...handover,
        steps: handover.steps.map((step, i) => i !== index ? step : {
            label: step.label,
            state: stepState,
            ...(detail === undefined ? {} : { detail }),
            ...(progress === undefined ? {} : { progress })
        })
    }));
    return {
        context,
        page: context.pages()[0] ?? await context.newPage(),
        handover: () => state,
        update,
        step,
        fail(error) {
            const reason = signal?.aborted ? new Error('Cancelled') : closed ? new Error('The browser window was closed.') : error;
            const index = state.steps.findIndex(running => running.state === 'active');
            if (index >= 0) step(index, 'failed', reason instanceof Error ? reason.message : String(reason));
            return signal?.aborted ? error : reason;
        }
    };
}

// The progress bar's share of the hand-over: the steps finished and the one at work, or what is left to the user.
export function stepProgress(handover: Handover): { done: number, total: number, message: string } {
    const now = handover.steps.find(step => step.state === 'active' || step.state === 'failed');
    return {
        done: handover.steps.filter(step => step.state === 'done' || step.state === 'warning').length,
        total: handover.steps.length,
        message: now ? `${now.label}: ${now.detail ?? ''}` : handover.next ?? 'Done'
    };
}

// The first deck or game ends up in front.
export async function showShopWindow() {
    for (const page of [...current?.pages() ?? []].reverse()) await page.bringToFront();
}

function startPage(title: string) {
    const html = `<!doctype html><title>Black Lotus Press</title>
<body style="margin:0;height:100vh;display:grid;place-content:center;background:#2b2b2b;color:#a5a5a2;font:16px system-ui,sans-serif">${title}…</body>`;
    return `data:text/html,${encodeURIComponent(html)}`;
}

// Runs in every page of the window. Bar and panel live in a shadow root, so the shop's styles leave them alone,
// and let clicks through everywhere else; the spotlight only darkens. Folding the panel holds for the session of the tab.
const OVERLAY = `(() => {
    if (window.top !== window) return;
    const start = () => {
        if (document.getElementById('black-lotus-press')) return;
        document.title = 'Black Lotus Press – ' + document.title;
        const host = document.createElement('div');
        host.id = 'black-lotus-press';
        host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = \`<style>
            * { box-sizing: border-box; }
            [hidden] { display: none !important; }
            .spot { position: fixed; border: 2px solid #19a7e0; border-radius: 6px; box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.55); transition: all 0.15s; }
            .callout { position: fixed; max-width: 22rem; padding: 0.6rem 0.8rem; border-radius: 4px; background: #19a7e0; color: #06141b;
                font: 600 15px/1.35 system-ui, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); }
            .bar { position: fixed; inset: 0 0 auto 0; display: flex; align-items: center; gap: 0.9rem; height: 44px; padding: 0 1rem;
                background: #2b2b2b; color: #e9e9e7; font: 15px/1.2 system-ui, sans-serif; pointer-events: auto; box-shadow: 0 2px 12px rgb(0 0 0 / 0.4); }
            .bar::after { content: ""; position: absolute; inset: auto 0 0 0; height: 4px; background: linear-gradient(90deg,
                #00aeef 0 11%, #ec008c 11% 22%, #fff200 22% 33%, #231f20 33% 44%, #2e3192 44% 52%, #00a651 52% 60%, #ed1c24 60% 68%,
                #7fd6f7 68% 76%, #f580c5 76% 84%, #fff880 84% 92%, #8a8a8a 92% 100%); }
            .brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; white-space: nowrap; }
            .title { color: #a5a5a2; white-space: nowrap; }
            .now { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .panel { position: fixed; top: 56px; right: 16px; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 72px); overflow-y: auto;
                border: 1px solid #4b4b4b; border-radius: 6px; background: #2b2b2b; color: #e9e9e7; font: 15px/1.4 system-ui, sans-serif;
                box-shadow: 0 12px 32px rgb(0 0 0 / 0.45); pointer-events: auto; }
            .panel header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 12px 16px; border-bottom: 1px solid #4b4b4b; }
            .panel.folded header { border-bottom: none; }
            .heading { font-weight: 700; font-size: 16px; }
            .summary { color: #a5a5a2; font-size: 14px; }
            .fold { padding: 3px 10px; border: 1px solid #4b4b4b; border-radius: 4px; background: none; color: #e9e9e7; font: inherit; font-size: 14px; cursor: pointer; }
            .fold:hover { border-color: #a5a5a2; }
            .steps { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 14px 16px; list-style: none; }
            .steps li { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; }
            .mark { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid #4b4b4b; border-radius: 50%; color: #a5a5a2; font-size: 13px; }
            .steps .active .mark { border-color: #19a7e0; color: #19a7e0; }
            .steps .done .mark { border-color: #19a7e0; background: #19a7e0; color: #06141b; }
            .steps .warning .mark { border-color: #e8c21c; color: #e8c21c; }
            .steps .failed .mark { border-color: #e0388a; color: #e0388a; }
            .label { display: block; font-weight: 600; font-size: 16px; }
            .steps .pending .label { color: #a5a5a2; }
            .detail { display: block; margin-top: 2px; color: #a5a5a2; font-size: 14px; }
            .steps .warning .detail { color: #e8c21c; }
            .steps .failed .detail { color: #e0388a; }
            .meter { height: 6px; margin-top: 8px; border-radius: 3px; background: #3c3c3c; overflow: hidden; }
            .meter i { display: block; height: 100%; background: #19a7e0; transition: width 0.3s; }
            .next { margin: 0; padding: 12px 16px; border-top: 1px solid #4b4b4b; border-left: 4px solid #19a7e0; background: #333333; font-weight: 600; }
            @media (max-width: 900px) { .title { display: none; } }
        </style>
        <div class="spot" hidden></div>
        <div class="callout" hidden></div>
        <section class="panel">
            <header><span><span class="heading">Progress</span> <span class="summary"></span></span><button class="fold" type="button"></button></header>
            <ol class="steps"></ol>
            <p class="next" hidden></p>
        </section>
        <div class="bar">
            <span class="brand"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 0v24M0 12h24" stroke="currentColor" stroke-width="1.2"/></svg>Black Lotus Press</span>
            <span class="title"></span>
            <span class="now"></span>
        </div>\`;
        document.documentElement.appendChild(host);
        const $ = selector => root.querySelector(selector);
        const marks = { pending: '', active: '●', done: '✓', warning: '!', failed: '✕' };
        const remembered = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
        let folded = remembered('black-lotus-press-folded') === 'yes';
        let state;

        $('.fold').addEventListener('click', () => {
            folded = !folded;
            try { sessionStorage.setItem('black-lotus-press-folded', folded ? 'yes' : 'no'); } catch {}
            render();
        });

        const element = (tag, className, text) => {
            const made = document.createElement(tag);
            made.className = className;
            if (text !== undefined) made.textContent = text;
            return made;
        };

        const render = () => {
            if (!state) return;
            $('.title').textContent = state.title;
            const now = state.steps.find(step => step.state === 'failed' || step.state === 'active');
            $('.now').textContent = now ? now.label + (now.detail ? ' · ' + now.detail : '') : state.next ?? '';
            const finished = state.steps.filter(step => step.state === 'done' || step.state === 'warning').length;
            $('.summary').textContent = finished + ' of ' + state.steps.length + ' done';
            $('.panel').classList.toggle('folded', folded);
            $('.fold').textContent = folded ? 'Show' : 'Hide';
            $('.steps').hidden = folded;
            $('.steps').replaceChildren(...state.steps.map(step => {
                const item = element('li', step.state);
                item.append(element('span', 'mark', marks[step.state]));
                const text = element('div', '');
                text.append(element('span', 'label', step.label));
                if (step.detail) text.append(element('span', 'detail', step.detail));
                if (step.progress && step.state === 'active') {
                    const meter = element('div', 'meter');
                    const fill = element('i', '');
                    fill.style.width = Math.min(100, 100 * step.progress.done / Math.max(step.progress.total, 1)) + '%';
                    meter.append(fill);
                    text.append(meter);
                }
                item.append(text);
                return item;
            }));
            const next = !now && finished === state.steps.length ? state.next : undefined;
            $('.next').textContent = next ?? '';
            $('.next').hidden = folded || !next;
        };

        const place = () => {
            const targets = (state?.highlight ?? []).flatMap(selector => [...document.querySelectorAll(selector)])
                .map(target => target.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
            const spot = $('.spot');
            const callout = $('.callout');
            spot.hidden = callout.hidden = targets.length === 0;
            if (targets.length > 0) {
                const left = Math.min(...targets.map(rect => rect.left)) - 16;
                const top = Math.min(...targets.map(rect => rect.top)) - 16;
                const right = Math.max(...targets.map(rect => rect.right)) + 16;
                const bottom = Math.max(...targets.map(rect => rect.bottom)) + 16;
                spot.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + (right - left) + 'px;height:' + (bottom - top) + 'px';
                callout.textContent = state.callout ?? '';
                const below = bottom + 12 + callout.offsetHeight < innerHeight;
                callout.style.cssText = 'left:' + Math.max(8, left) + 'px;top:' + (below ? bottom + 12 : Math.max(52, top - 12 - callout.offsetHeight)) + 'px';
            }
            requestAnimationFrame(place);
        };

        let shown = '';
        const poll = async () => {
            try {
                state = await window.__blackLotusPress();
                // Rendering only on a change keeps the fold button clickable.
                const seen = JSON.stringify(state);
                if (seen !== shown) {
                    shown = seen;
                    render();
                }
            } catch {}
            setTimeout(poll, 400);
        };
        void poll();
        requestAnimationFrame(place);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;
