import { type BrowserContext, type Dialog, errors, type Page } from "playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { cardsDir } from "../config/paths.js";
import type { HandoverStep, OnProgress, Order } from "../model.js";
import { buildPacks, cardBackFace, shopDeck, type Slot } from "../pipeline/packs.js";
import { openShopWindow, type WindowBounds } from "./shopWindow.js";

const BASE_URL = 'https://www.printerstudio.de';
// Blank cards of 63 × 88 mm on Standard (glatt) stock.
const PRODUCT_URL = `${BASE_URL}/machen/blanko-spielkarten-63x88mm-personalisieren.html`;
const STANDARD_STOCK = 'PA_018';
const LOGIN_URL = `${BASE_URL}/login.aspx`;
// The visible login button is an empty link with a picture.
const LOGIN_FORM = ['#txt_email', '#txt_password', 'a[href="javascript:btn_submit_onclick();"]'];
// The designer has a hidden logout link for guests as well, so only a visible one means logged in.
const LOGGED_IN = `a[href="${BASE_URL}/logout.aspx"]:visible`;
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const SAVED = 'Speicherung erfolgreich';
const SAVE_TIMEOUT_MS = 60_000;
const DIALOG_TIMEOUT_MS = 60_000;
const UPLOAD_TRIES = 3;
const UPLOAD_TIMEOUT_MS = 2 * 60_000;
const POLL_MS = 500;
// Large images upload slowly, but the designer never stands still for this long.
const STALL_MS = 5 * 60_000;

// The images of one side of a deck: one per card, or a single one that every card gets.
export interface Side {
    files: string[];
    same: boolean;
}

export function deckSides(pack: Slot[], cardBack: string): [front: Side, back: Side] {
    const backs = pack.map(slot => slot.back);
    return [
        { files: pack.map(slot => slot.front), same: false },
        backs.every(back => back === cardBack) ? { files: [cardBack], same: true } : { files: backs, same: false }
    ];
}

// printerstudio.de takes 32 characters; like MPC Autofill's desktop tool, the name ends with the date.
export function projectName(order: string, deck: number, decks: number, today: Date) {
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const suffix = decks > 1 ? ` ${deck + 1}/${decks}` : '';
    const room = 32 - suffix.length - 1 - date.length;
    const name = order.length > room ? `${order.slice(0, room - 3).trimEnd()}...` : order;
    return `${name}${suffix} ${date}`;
}

// After the user logs in, fills one designer per deck, each in its own window, saves it as a project of the account and
// leaves it at the preview: confirming the copyright and putting the deck into the cart is up to the user.
// On success the browser stays open; the caller closes it. `unsaved` are the decks printerstudio.de did not confirm saving.
export async function sendToPrinterstudio(order: Order, bounds: WindowBounds | undefined, onProgress?: OnProgress, signal?: AbortSignal):
    Promise<{ context: BrowserContext, unsaved: number[] }> {
    const dir = cardsDir(order);
    const decks = buildPacks(order).packs.map(pack => deckSides(pack, cardBackFace(order).file));

    // The designer names every upload after the SHA-1 of the file, so the ids are known beforehand.
    const pids = new Map<string, string>();
    for (const file of new Set(decks.flat().flatMap(side => side.files))) {
        pids.set(file, createHash('sha1').update(await readFile(path.join(dir, file))).digest('hex').toUpperCase());
    }

    const window = await openShopWindow(order.profile.playwrightChannel, bounds, {
        order: order.name,
        title: `${order.name} to printerstudio.de`,
        steps: [
            { label: 'Log in', state: 'active', detail: 'In this window, or sign up; Black Lotus Press never sees your password.' },
            ...decks.map((_, index): HandoverStep => ({ label: `Deck ${index + 1} of ${decks.length}`, state: 'pending' }))
        ],
        highlight: LOGIN_FORM,
        callout: 'Log in here, or sign up. Black Lotus Press carries on by itself.'
    }, onProgress, signal);

    // Every image uploaded and every card put into its slot.
    const steps = (side: Side) => new Set(side.files).size + side.files.length;
    const total = decks.flat().reduce((sum, side) => sum + steps(side), 0);
    let done = 0;
    const reporter = (deck: number, side: string, sideTotal: number) => {
        const before = done;
        return (count: number, message: string) => {
            done = before + count;
            onProgress?.({ type: 'progress', done, total, message: `Deck ${deck + 1} of ${decks.length}, ${side}: ${message}` });
            window.step(deck + 1, 'active', `${side}: ${message}`, { done: count, total: sideTotal });
        };
    };

    try {
        const login = window.page;
        onProgress?.({ type: 'progress', done: 0, total, message: 'Log in or sign up at printerstudio.de in the browser window' });
        await login.goto(LOGIN_URL);
        await login.locator(LOGGED_IN).first().waitFor({ timeout: LOGIN_TIMEOUT_MS }).catch(error => {
            throw error instanceof errors.TimeoutError ? new Error(`Not logged in to printerstudio.de within ${LOGIN_TIMEOUT_MS / 60_000} minutes.`) : error;
        });
        window.update(handover => ({ ...handover, highlight: [], callout: '' }));
        window.step(0, 'done', 'Logged in');

        const unsaved: number[] = [];
        const today = new Date();
        for (const [index, [front, back]] of decks.entries()) {
            const page = index === 0 ? login : await window.context.newPage();
            const cards = front.files.length;
            const name = projectName(order.name, index, decks.length, today);
            window.step(index + 1, 'active', 'Opening the designer');

            await page.goto(PRODUCT_URL);
            await page.selectOption('#dro_paper_type', STANDARD_STOCK);
            await page.selectOption('#dro_choosesize', String(shopDeck('printerstudio', cards)[0]));
            await page.evaluate(`doPersonalize('${BASE_URL}/products/pro_item_process_flow.aspx')`);
            await page.waitForURL(/dn_playingcards_front_dynamic/);

            // Saved after the fronts as well, so the uploads are kept in the account when the backs fail.
            await fillSide(page, front, cards, pids, dir, reporter(index, 'fronts', steps(front)));
            await saveProject(page, name);
            await nextStep(page, /dn_texteditor_front/);
            await nextStep(page, /dn_playingcards_back_dynamic/);
            await fillSide(page, back, cards, pids, dir, reporter(index, 'backs', steps(back)));
            onProgress?.({ type: 'progress', done, total, message: `Deck ${index + 1} of ${decks.length}: saving it as "${name}" in your account` });
            window.step(index + 1, 'active', `Saving it as "${name}" in your account`);
            const saved = await saveProject(page, name);
            if (!saved) unsaved.push(index + 1);
            await nextStep(page, /dn_texteditor_back/);
            await nextStep(page, /dn_preview_layout/);
            window.step(index + 1, saved ? 'done' : 'warning', saved
                ? `Saved as "${name}" in your account, waiting at the preview`
                : `At the preview, but printerstudio.de did not confirm saving "${name}"; save it with Speichern`);
        }

        onProgress?.({ type: 'progress', done: total, total, message: `Filled ${decks.length} deck(s) at printerstudio.de` });
        window.update(handover => ({ ...handover, next: 'Check every deck at its preview, confirm the copyright and put it into the cart.' }));
        return { context: window.context, unsaved };
    } catch (error) {
        const reason = window.fail(error);
        await window.context.close();
        throw reason;
    }
}

// A dialog asks for the number of cards and whether they share one image; then the slots dnImg0_0_0 and on appear.
async function fillSide(page: Page, side: Side, cards: number, pids: Map<string, string>, dir: string, report: (done: number, message: string) => void) {
    const dialog = await (await page.locator('#sysifm_loginFrame').elementHandle())!.contentFrame();
    // Until it has loaded, the dialog takes at most 54 cards, whatever the deck size.
    await dialog!.waitForFunction(`typeof setMode === 'function' && String(window.OriginalCount) === document.getElementById('hidd_original_count')?.value`);

    // A number it does not take is answered with an alert, and the dialog stays open.
    const alerts: string[] = [];
    const onDialog = (shown: Dialog) => {
        alerts.push(shown.message());
        void shown.dismiss();
    };
    page.on('dialog', onDialog);
    try {
        await dialog!.evaluate(`document.getElementById('txt_card_number').value = '${cards}'; setMode('ImageText', ${side.same ? 1 : 0})`);
        await page.locator('#sysifm_loginFrame').waitFor({ state: 'detached', timeout: DIALOG_TIMEOUT_MS });
    } catch (error) {
        throw alerts.length > 0 ? new Error(`printerstudio.de did not take the ${cards} cards: ${alerts.join(' ')}`) : error;
    } finally {
        page.off('dialog', onDialog);
    }
    await page.locator(`#dnImg${side.files.length - 1}_0_0`).waitFor({ state: 'attached' });

    const files = [...new Set(side.files)];
    for (const [index, file] of files.entries()) {
        report(index, `uploading ${index + 1} of ${files.length} images`);
        await upload(page, path.join(dir, file), pids.get(file)!);
    }

    const slots = side.files.map(file => pids.get(file)!);
    await page.evaluate(`(() => {
        const layout = oDesign.layout;
        const pids = ${JSON.stringify(slots)};
        oDesign.setAutoFillHandle(pids.map(pid => layout.getPhotoIdKey(pid, 0)), pids.map((_, slot) => layout.getElement3('dnImg', slot)));
    })()`);
    await track(async () => slots.length - (await page.evaluate('oDesign.layout.PhotoPostList.length') as number), slots.length,
        count => report(files.length + count, `${count} of ${slots.length} cards in their slots`),
        async () => 'printerstudio.de stopped putting the images into their slots');

    const placed = await page.evaluate(`${JSON.stringify(slots)}.map((_, slot) => oDesign.layout.getPhotoId(oDesign.layout.getElement3('dnImg', slot)))`) as (string | null)[];
    const wrong = side.files.filter((_, slot) => placed[slot] !== slots[slot]);
    if (wrong.length > 0) throw new Error(`printerstudio.de left ${wrong.join(', ')} out of their slots`);
}

// One file at a time, like MPC Autofill's desktop tool, so every image gets its own tries.
async function upload(page: Page, file: string, pid: string) {
    const inAlbum = `document.querySelector('#U_Upload img[pid="${pid}"]') !== null`;
    for (let attempt = 1; !await page.evaluate(inAlbum); attempt++) {
        if (attempt > UPLOAD_TRIES) throw new Error(`printerstudio.de did not take ${path.basename(file)} in ${UPLOAD_TRIES} tries.`);
        await page.setInputFiles('#uploadId', file);
        await page.waitForFunction(inAlbum, null, { timeout: UPLOAD_TIMEOUT_MS, polling: POLL_MS }).catch(error => {
            if (!(error instanceof errors.TimeoutError)) throw error;
        });
    }
}

// Among the saved projects of the account; saving it again keeps it up to date. False when printerstudio.de does not confirm it.
async function saveProject(page: Page, name: string): Promise<boolean> {
    await page.locator('#txt_temporaryname').fill(name);
    await page.evaluate('oDesign.setTemporarySave()');
    return await page.locator('#div_temporarysavestatus', { hasText: SAVED }).waitFor({ timeout: SAVE_TIMEOUT_MS }).then(() => true, () => false);
}

// The designer saves the step before it goes on to the next one.
async function nextStep(page: Page, url: RegExp) {
    await page.evaluate('oDesign.setNextStep()');
    await page.waitForURL(url, { timeout: STALL_MS });
}

async function track(count: () => Promise<number>, total: number, report: (done: number) => void, stalled: () => Promise<string>) {
    let last = -1;
    let since = Date.now();
    for (;;) {
        const done = await count();
        if (done !== last) {
            last = done;
            since = Date.now();
            report(done);
        }
        if (done >= total) return;
        if (Date.now() - since > STALL_MS) throw new Error(await stalled());
        await setTimeout(POLL_MS);
    }
}
