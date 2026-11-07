import { type BrowserContext, errors, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { HandoverStep, OnProgress, Order, UploadedGame } from "../model.js";
import { buildPacks, type Face, type Slot } from "../pipeline/packs.js";
import { faceJobs, usedBaseImages, writePrintPng } from "../pipeline/processImages.js";
import { openShopWindow, type ShopWindow, stepProgress, type WindowBounds } from "./shopWindow.js";

const BASE_URL = 'https://www.meinspiel.de';
// "Individuelle Spielkarten - 55 Karten - 63*88mm" with an image per card side, which keeps its full resolution.
const TEMPLATE_ID = 17;
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const COOKIE_BANNER_TIMEOUT_MS = 15 * 1000;
const SETTLE_LOADS = 5;

export interface MeinspielSession {
    context: BrowserContext,
    page: Page
}

async function acceptAllCookies(page: Page) {
    try {
        await page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').click({ timeout: COOKIE_BANNER_TIMEOUT_MS });
        await page.locator('#CybotCookiebotDialog').waitFor({ state: 'hidden', timeout: COOKIE_BANNER_TIMEOUT_MS });
    } catch (error) {
        // The upload works without consent, so a banner that never shows up is no reason to stop.
        if (!(error instanceof errors.TimeoutError)) throw error;
    }
}

const sessionId = async (session: MeinspielSession) =>
    (await session.context.cookies(BASE_URL)).find(cookie => cookie.name === 'PHPSESSID')?.value;

// meinspiel.de gives a new session another id on its first loads, and a login made before that is lost.
export async function settleSession(session: MeinspielSession) {
    let id = await sessionId(session);
    for (let load = 0; load < SETTLE_LOADS; load++) {
        await session.page.request.get(`${BASE_URL}/login`);
        const next = await sessionId(session);
        if (next && next === id) return;
        id = next;
    }
}

// The user logs in by hand in the visible browser; the tool never sees the credentials.
// Asks only once a page has loaded: a request of the app's own crossing the login form on its way can cost the user that login.
export async function waitForLogin(session: MeinspielSession): Promise<string> {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    for (;;) {
        const user = await (await session.page.request.get(`${BASE_URL}/api/users`)).json();
        if (user.id !== 0) return user.username || user.email;

        await session.page.waitForEvent('load', { timeout: Math.max(deadline - Date.now(), 1) }).catch(error => {
            throw error instanceof errors.TimeoutError ? new Error(`Not logged in to meinspiel.de within ${LOGIN_TIMEOUT_MS / 60000} minutes.`) : error;
        });
    }
}

// The game as meinspiel.de creates it: ids like "p223341110", fronts under p1000 and backs under p150, in the order of the cards.
interface CreatedGame {
    id: number;
    userId: number;
    cards: { byIndex: Record<string, string[]>, byId: Record<string, { mainLayerId: string }> };
}

export type CardRequest =
    | { type: 'upload', card: number, layer: number, file: string }
    | { type: 'copyToNext', card: number, count: number }
    | { type: 'copyFrom', card: number, from: number };

const SIDES = [['p1000', 'front', 'fronts'], ['p150', 'back', 'backs']] as const;
const idOf = (key: string) => Number(key.slice(1));

// Every image goes up once; meinspiel.de copies it to the other cards that show it, without taking another of the game's 110 image slots.
export function packRequests(game: CreatedGame, pack: Slot[]): CardRequest[] {
    const requests: CardRequest[] = [];
    for (const [key, side, label] of SIDES) {
        const cards = game.cards.byIndex[key] ?? [];
        if (cards.length !== pack.length) throw new Error(`meinspiel.de made a game with ${cards.length} ${label} for ${pack.length} cards.`);

        const first = new Map<string, string>();
        for (let index = 0; index < pack.length;) {
            const file = pack[index]![side];
            let run = 1;
            while (pack[index + run]?.[side] === file) run++;

            const card = cards[index]!;
            const source = first.get(file);
            if (source === undefined) {
                first.set(file, card);
                requests.push({ type: 'upload', card: idOf(card), layer: idOf(game.cards.byId[card]!.mainLayerId), file });
            } else {
                requests.push({ type: 'copyFrom', card: idOf(card), from: idOf(source) });
            }
            if (run > 1) requests.push({ type: 'copyToNext', card: idOf(card), count: run - 1 });
            index += run;
        }
    }
    return requests;
}

// Uses the configurator's own API through the logged-in browser. Games created while logged in are saved to the account.
// The images are made as PNGs one at a time in a folder of their own, as a pack of them at 1200 dpi takes gigabytes.
export async function uploadPack(session: MeinspielSession, order: Order, faces: Map<string, Face>, pack: Slot[], name: string,
                                 onStatus: (message: string, progress?: HandoverStep['progress']) => void, signal?: AbortSignal) {
    const request = session.page.request;

    onStatus(`Creating the game "${name}"`);
    const gameResponse = await request.post(`${BASE_URL}/api/games`, { data: { templateId: TEMPLATE_ID, name } });
    if (!gameResponse.ok()) {
        throw new Error(`Creating the game failed (${gameResponse.status()}): ${await gameResponse.text()}`);
    }
    const game: CreatedGame = await gameResponse.json();
    const requests = packRequests(game, pack);

    const megabytes = (bytes: number) => Math.round(bytes / 1e6);
    const total = requests.filter(card => card.type === 'upload').length;
    const userAgent = await session.page.evaluate('navigator.userAgent') as string;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'black-lotus-press-'));
    try {
        let done = 0;
        for (const card of requests) {
            signal?.throwIfAborted();
            if (card.type !== 'upload') {
                const copy = card.type === 'copyToNext' ? `copyToNext=${card.count}` : `copyFrom=${card.from}`;
                const response = await request.post(`${BASE_URL}/api/games/${game.id}/cards/${card.card}?&${copy}`, { data: {} });
                if (!response.ok()) throw new Error(`Copying an image to card ${card.card} failed (${response.status()}): ${await response.text()}`);
                continue;
            }

            onStatus(`Making image ${done + 1} of ${total}`, { done, total });
            const file = path.join(dir, `${path.parse(card.file).name}.png`);
            await writePrintPng(order, faces.get(card.file)!, file);
            let shown = -1;
            const cookies = await session.context.cookies(BASE_URL);
            const browser = { cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), userAgent };
            const response = await postMultipart(`${BASE_URL}/api/games/${game.id}/cards/${card.card}/layers/${card.layer}/image`, browser,
                [['imagefile[]', file]], (sent, size) => {
                    if (megabytes(sent) === shown) return;
                    shown = megabytes(sent);
                    onStatus(`Uploading image ${done + 1} of ${total}: ${shown} of ${megabytes(size)} MB`, { done, total });
                }, signal);
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Uploading image ${done + 1} failed (${response.status}): ${response.body}`);
            }
            await fs.rm(file);
            done++;
        }
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }

    return { id: game.id, saved: game.userId !== 0 };
}

function gameUrl(gameId: number) {
    return `${BASE_URL}/konfigurator/game/${gameId}?tid=${TEMPLATE_ID}`;
}

export async function showGames(session: MeinspielSession, gameIds: number[]) {
    for (const gameId of gameIds) {
        const tab = await session.page.context().newPage();
        await tab.goto(gameUrl(gameId));
    }
    await session.page.close();
}

// Playwright's requests tell nothing until they are done, so the images go up through Node with the window's cookies,
// counting the bytes as they leave.
export async function postMultipart(url: string, browser: { cookie: string, userAgent: string }, files: [field: string, file: string][],
                                    onSent: (bytes: number, total: number) => void, signal?: AbortSignal): Promise<{ status: number, body: string }> {
    const boundary = `BlackLotusPress${randomUUID()}`;
    const parts = await Promise.all(files.map(async ([field, file]) => ({
        head: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${path.basename(file)}"\r\nContent-Type: image/png\r\n\r\n`),
        file,
        size: (await fs.stat(file)).size
    })));
    const end = Buffer.from('\r\n');
    const tail = Buffer.from(`--${boundary}--\r\n`);
    const total = parts.reduce((sum, part) => sum + part.head.length + part.size + end.length, tail.length);

    return await new Promise((resolve, reject) => {
        const request = (url.startsWith('https:') ? https : http).request(url, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                cookie: browser.cookie,
                'user-agent': browser.userAgent,
                'content-type': `multipart/form-data; boundary=${boundary}`,
                'content-length': total
            },
            timeout: PROCESSING_TIMEOUT_MS,
            ...(signal ? { signal } : {})
        }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
            response.on('error', reject);
        });
        request.on('error', reject);
        request.on('timeout', () => request.destroy(new Error(`meinspiel.de took nothing for ${PROCESSING_TIMEOUT_MS / 60000} minutes.`)));

        let sent = 0;
        // Waits while the connection is full, or until it is gone.
        const send = (chunk: Buffer) => new Promise<void>(done => {
            if (request.write(chunk)) return done();
            const resume = () => {
                request.off('drain', resume);
                request.off('close', resume);
                done();
            };
            request.on('drain', resume);
            request.on('close', resume);
        }).then(() => onSent(sent += chunk.length, total));
        void (async () => {
            for (const part of parts) {
                await send(part.head);
                for await (const chunk of createReadStream(part.file)) await send(chunk as Buffer);
                await send(end);
            }
            await send(tail);
            request.end();
        })().catch(error => request.destroy(error));
    });
}

// Saved games are in the account, so the browser closes and the app lists them.
// A game that is not saved only exists in this browser's session, so then the browser stays open with those games and is returned.
export async function finishUpload(window: Pick<ShopWindow, 'update'>, session: MeinspielSession, games: UploadedGame[]) {
    const unsaved = games.filter(game => !game.saved);
    window.update(handover => ({
        ...handover,
        links: games.map(game => ({ label: game.name, url: game.url })),
        next: unsaved.length === 0
            ? 'Every game is saved in your meinspiel.de account. Open it to choose the box and order; the links open in your usual browser, which needs to be logged in to meinspiel.de.'
            : 'Click Speichern in the window of every game that is not saved, then choose the box and order on meinspiel.de.'
    }));
    if (unsaved.length === 0) {
        await session.context.close();
        return undefined;
    }
    await showGames(session, unsaved.map(game => game.id));
    return session;
}

type Step = (index: number, state: HandoverStep['state'], detail?: string, progress?: HandoverStep['progress']) => void;

// Goes on after the packs done before. A pack that fails ends it, and the games made until then come back with the error.
export async function uploadMissingPacks(session: MeinspielSession, order: Order, packs: Slot[][], done: UploadedGame[], step: Step,
                                         signal?: AbortSignal): Promise<{ games: UploadedGame[], error?: unknown }> {
    const games = [...done];
    const faces = faceJobs(order);
    for (const [index, pack] of packs.entries()) {
        if (index < done.length) continue;
        const name = `${order.name} - Deck ${index + 1}/${packs.length}`;
        try {
            const game = await uploadPack(session, order, faces, pack, name, (message, progress) => step(index + 1, 'active', message, progress), signal);
            games.push({ ...game, name, url: gameUrl(game.id) });
            step(index + 1, game.saved ? 'done' : 'warning',
                game.saved ? `Saved in your account as "${name}"` : `"${name}" is not saved in your account; click Speichern in its window`);
        } catch (error) {
            return { games, error };
        }
    }
    return { games };
}

// Each step of the upload is a step of the hand-over, which the app and the bar over meinspiel.de's pages show.
// The games of the packs uploaded before are passed in as done; a failed pack returns the games made until then.
// Refuses before the browser opens when an image is missing, as no game can be made without it.
export async function uploadToMeinspiel(order: Order, done: UploadedGame[], bounds: WindowBounds | undefined, onProgress?: OnProgress, signal?: AbortSignal) {
    const { packs } = buildPacks(order);
    const ready = new Set(await usedBaseImages(order));
    const missing = new Set([...faceJobs(order).values()].flatMap(face => face.base && !ready.has(face.base) ? [face.base] : []));
    if (missing.size > 0) throw new Error(`${missing.size} card image(s) are not processed yet. Process the images first.`);

    const orderName = order.name;
    const steps: HandoverStep[] = [
        { label: 'Log in', state: 'active', detail: 'In this window, or create an account; Black Lotus Press never sees your password.' },
        ...packs.map((_, index): HandoverStep => index < done.length
            ? { label: `Pack ${index + 1} of ${packs.length}`, state: 'done', detail: `Uploaded before as "${done[index]!.name}"` }
            : { label: `Pack ${index + 1} of ${packs.length}`, state: 'pending' })
    ];
    const window = await openShopWindow(order.profile.playwrightChannel, bounds, {
        order: orderName, title: `${orderName} to meinspiel.de`, steps,
        highlight: ['form[action$="/login"]'], callout: 'Log in here, or create an account. Black Lotus Press carries on by itself.'
    }, onProgress, signal);
    const session = { context: window.context, page: window.page };
    const step = progressOf(window, onProgress);

    try {
        await settleSession(session);
        await session.page.goto(`${BASE_URL}/login`);
        await acceptAllCookies(session.page);
        const user = await waitForLogin(session);
        window.update(handover => ({ ...handover, highlight: [], callout: '' }));
        step(0, 'done', `Logged in as ${user}`);

        await window.block();
        const { games, error } = await uploadMissingPacks(session, order, packs, done, step, signal);
        window.unblock();
        if (error === undefined) return { session: await finishUpload(window, session, games), games };

        const reason = window.fail(error);
        await session.context.close();
        return { session: undefined, games, error: reason };
    } catch (error) {
        const reason = window.fail(error);
        await session.context.close();
        throw reason;
    }
}

// Sets a step and reports the steps as the progress, so the bar counts what really happened.
function progressOf(window: ShopWindow, onProgress?: OnProgress) {
    return (index: number, state: HandoverStep['state'], detail?: string, progress?: HandoverStep['progress']) => {
        window.step(index, state, detail, progress);
        onProgress?.({ type: 'progress', ...stepProgress(window.handover()) });
    };
}
