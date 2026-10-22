import { type APIRequestContext, type BrowserContext, errors, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { HandoverStep, OnProgress, PackFiles, PlaywrightChannel, UploadedGame } from "../model.js";
import { openShopWindow, type ShopWindow, stepProgress, type WindowBounds } from "./shopWindow.js";

const BASE_URL = 'https://www.meinspiel.de';
// "Individuelle Spielkarten (PDF) - 55 Karten - 63*88mm"
const TEMPLATE_ID = 10098;
const PAGE_ID = 'individuelle_karten';
const POLL_INTERVAL_MS = 3000;
export const MANUAL_UPLOAD_URL = `${BASE_URL}/konfigurator/game?tid=${TEMPLATE_ID}&item_id=${PAGE_ID}`;
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

// Uses the configurator's own API through the logged-in browser. Games created while logged in are saved to the account.
export async function uploadPack(session: MeinspielSession, pack: PackFiles, name: string,
                                 onStatus: (message: string, progress?: HandoverStep['progress']) => void, signal?: AbortSignal) {
    const request = session.page.request;

    onStatus(`Creating the game "${name}"`);
    const gameResponse = await request.post(`${BASE_URL}/api/games`, {
        data: { templateId: TEMPLATE_ID, name, pageId: PAGE_ID }
    });
    if (!gameResponse.ok()) {
        throw new Error(`Creating the game failed (${gameResponse.status()}): ${await gameResponse.text()}`);
    }
    const gameId: number = (await gameResponse.json()).id;

    const megabytes = (bytes: number) => Math.round(bytes / 1e6);
    let shown = -1;
    const cookies = await session.context.cookies(BASE_URL);
    const browser = { cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), userAgent: await session.page.evaluate('navigator.userAgent') as string };
    const uploadResponse = await postMultipart(`${BASE_URL}/api/games/${gameId}/pdf/async`, browser,
        [['pdf_front_sides', pack.fronts], ['pdf_back_sides', pack.backs]], (sent, total) => {
            if (megabytes(sent) === shown) return;
            shown = megabytes(sent);
            onStatus(`Uploading its two PDFs: ${shown} of ${megabytes(total)} MB`, { done: sent, total });
        }, signal);
    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        throw new Error(`Uploading the PDFs failed (${uploadResponse.status}): ${uploadResponse.body}`);
    }
    const taskId: number = JSON.parse(uploadResponse.body).id;

    const game = await waitForProcessing(request, gameId, taskId, onStatus);
    return { id: gameId, saved: game.userId !== 0 };
}

async function waitForProcessing(request: APIRequestContext, gameId: number, taskId: number, onStatus: (message: string) => void) {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await delay(POLL_INTERVAL_MS);

        // 409 means still processing, 200 returns the finished game.
        const status = await request.get(`${BASE_URL}/api/games/${gameId}/pdf/async/${taskId}`);
        if (status.status() === 200) return await status.json();
        if (status.status() !== 409) {
            throw new Error(`meinspiel.de rejected the PDFs (${status.status()}): ${await status.text()}`);
        }

        onStatus(`meinspiel.de processes the PDFs: ${(await status.json()).statusMessage}`);
    }

    throw new Error(`meinspiel.de did not finish processing the PDFs within ${PROCESSING_TIMEOUT_MS / 60000} minutes.`);
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

// Playwright's requests tell nothing until they are done, so the PDFs go up through Node with the window's cookies,
// counting the bytes as they leave.
export async function postMultipart(url: string, browser: { cookie: string, userAgent: string }, files: [field: string, file: string][],
                                    onSent: (bytes: number, total: number) => void, signal?: AbortSignal): Promise<{ status: number, body: string }> {
    const boundary = `BlackLotusPress${randomUUID()}`;
    const parts = await Promise.all(files.map(async ([field, file]) => ({
        head: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${path.basename(file)}"\r\nContent-Type: application/pdf\r\n\r\n`),
        file,
        size: (await stat(file)).size
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
            request.once('drain', done);
            request.once('close', done);
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

// Each step of the upload is a step of the hand-over, which the app and the bar over meinspiel.de's pages show.
export async function uploadToMeinspiel(orderName: string, packs: PackFiles[], channel: PlaywrightChannel, bounds: WindowBounds | undefined,
                                        onProgress?: OnProgress, signal?: AbortSignal) {
    const steps: HandoverStep[] = [
        { label: 'Log in', state: 'active', detail: 'In this window, or create an account; Black Lotus Press never sees your password.' },
        ...packs.map((_, index): HandoverStep => ({ label: `Pack ${index + 1} of ${packs.length}`, state: 'pending' }))
    ];
    const window = await openShopWindow(channel, bounds, {
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

        const games: UploadedGame[] = [];
        for (const [index, pack] of packs.entries()) {
            const name = `${orderName} - Deck ${index + 1}/${packs.length}`;
            const game = await uploadPack(session, pack, name, (message, progress) => step(index + 1, 'active', message, progress), signal);
            games.push({ ...game, name, url: gameUrl(game.id) });
            step(index + 1, game.saved ? 'done' : 'warning',
                game.saved ? `Saved in your account as "${name}"` : `"${name}" is not saved in your account; click Speichern in its window`);
        }

        return { session: await finishUpload(window, session, games), games };
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
