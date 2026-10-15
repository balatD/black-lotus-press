import { type APIRequestContext, type Browser, chromium, errors, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { OnProgress, PackFiles, PlaywrightChannel, UploadedGame } from "../model.js";

const BASE_URL = 'https://www.meinspiel.de';
// "Individuelle Spielkarten (PDF) - 55 Karten - 63*88mm"
const TEMPLATE_ID = 10098;
const PAGE_ID = 'individuelle_karten';
const POLL_INTERVAL_MS = 3000;
export const MANUAL_UPLOAD_URL = `${BASE_URL}/konfigurator/game?tid=${TEMPLATE_ID}&item_id=${PAGE_ID}`;
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const COOKIE_BANNER_TIMEOUT_MS = 15 * 1000;

export interface MeinspielSession {
    browser: Browser,
    page: Page
}


// Aborting closes the browser, so the pending call fails right away.
export async function openMeinspielSession(channel: PlaywrightChannel, signal?: AbortSignal): Promise<MeinspielSession> {
    const browser = await chromium.launch({ channel, headless: false });
    signal?.addEventListener('abort', () => void browser.close(), { once: true });
    if (signal?.aborted) {
        await browser.close();
        signal.throwIfAborted();
    }
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE_URL}/login`);
    await acceptAllCookies(page);
    return { browser, page };
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

// The user logs in by hand in the visible browser; the tool never sees the credentials.
export async function waitForLogin(session: MeinspielSession): Promise<string> {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const user = await (await session.page.request.get(`${BASE_URL}/api/users`)).json();
        if (user.id !== 0) return user.username || user.email;

        await delay(POLL_INTERVAL_MS);
    }

    throw new Error(`Not logged in to meinspiel.de within ${LOGIN_TIMEOUT_MS / 60000} minutes.`);
}

// Uses the configurator's own API through the logged-in browser. Games created while logged in are saved to the account.
export async function uploadPack(session: MeinspielSession, pack: PackFiles, name: string, onStatus: (message: string) => void) {
    const request = session.page.request;

    const gameResponse = await request.post(`${BASE_URL}/api/games`, {
        data: { templateId: TEMPLATE_ID, name, pageId: PAGE_ID }
    });
    if (!gameResponse.ok()) {
        throw new Error(`Creating the game failed (${gameResponse.status()}): ${await gameResponse.text()}`);
    }
    const gameId: number = (await gameResponse.json()).id;

    const uploadResponse = await request.post(`${BASE_URL}/api/games/${gameId}/pdf/async`, {
        headers: { accept: 'application/json' },
        multipart: {
            pdf_front_sides: await pdfFile(pack.fronts),
            pdf_back_sides: await pdfFile(pack.backs)
        },
        timeout: PROCESSING_TIMEOUT_MS
    });
    if (!uploadResponse.ok()) {
        throw new Error(`Uploading the PDFs failed (${uploadResponse.status()}): ${await uploadResponse.text()}`);
    }
    const taskId: number = (await uploadResponse.json()).id;

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

        onStatus((await status.json()).statusMessage);
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

async function pdfFile(filePath: string) {
    return { name: path.basename(filePath), mimeType: 'application/pdf', buffer: await readFile(filePath) };
}

// On success the browser stays open so the user can order; the caller closes it.
export async function uploadToMeinspiel(orderName: string, packs: PackFiles[], channel: PlaywrightChannel, onProgress?: OnProgress, signal?: AbortSignal) {
    const session = await openMeinspielSession(channel, signal);
    const report = (done: number, message: string) => onProgress?.({ type: 'progress', done, total: packs.length, message });

    try {
        report(0, 'Log in to meinspiel.de in the opened browser (or create an account there)');
        const user = await waitForLogin(session);

        const games: UploadedGame[] = [];
        for (const [index, pack] of packs.entries()) {
            const name = `${orderName} - Deck ${index + 1}/${packs.length}`;
            report(index, `Logged in as ${user}. Uploading "${name}"`);
            const game = await uploadPack(session, pack, name, message => report(index, `"${name}": ${message}`));
            games.push({ ...game, name, url: gameUrl(game.id) });
        }

        await showGames(session, games.map(game => game.id));
        report(packs.length, `Uploaded ${games.length} deck(s)`);
        return { session, games };
    } catch (error) {
        await session.browser.close();
        throw error;
    }
}
