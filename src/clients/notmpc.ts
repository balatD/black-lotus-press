import { type Browser, chromium, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import sharp from "sharp";
import { cardsDir } from "../config/paths.js";
import type { OnProgress, Order } from "../model.js";
import { buildPacks, cardBackFace, type Face, notmpcDeck } from "../pipeline/packs.js";
import { faceJobs } from "../pipeline/processImages.js";
import { hasBleed } from "../pipeline/customImage.js";
import { pageSizeInPixels } from "../output/printImage.js";
import { notmpcXml } from "../output/notmpcXml.js";
import { downloadDriveImage, driveImageUrl } from "./googleDrive.js";

const BASE_URL = 'https://notmpc.eu';
// After many uploads in a row notmpc.eu asks to wait a few minutes; a minute at a time, up to a quarter of an hour.
const UPLOAD_PAUSE_MS = 60_000;
const UPLOAD_PAUSES = 15;

function designerUrl(cards: number) {
    return `${BASE_URL}/de/stepper/?border=none&size=${notmpcDeck(cards)[0]}&finish=BLACKCORE`;
}

// Links or uploads the print images and opens one designer per deck with every card in its slot.
// On success the browser stays open so the user can order; the caller closes it.
export async function sendToNotmpc(order: Order, onProgress?: OnProgress, signal?: AbortSignal): Promise<Browser> {
    const { packs } = buildPacks(order);
    const faces = [...faceJobs(order).values()];
    const height = pageSizeInPixels(order.profile.postProcessing.dpi).height;

    // Aborting closes the browser, so the pending call fails right away.
    const browser = await chromium.launch({ channel: order.profile.playwrightChannel, headless: false });
    signal?.addEventListener('abort', () => void browser.close(), { once: true });
    if (signal?.aborted) {
        await browser.close();
        signal.throwIfAborted();
    }

    try {
        const page = await (await browser.newContext()).newPage();
        await page.goto(designerUrl(packs[0]!.length));

        const urls = new Map<string, string>();
        for (const [index, face] of faces.entries()) {
            const report = (message: string) => onProgress?.({ type: 'progress', done: index, total: faces.length, message });
            report('Linking and uploading the images for notmpc.eu');
            urls.set(face.file, await linkedImage(face, height) ?? await uploadImage(page, path.join(cardsDir(order), face.file), report, signal));
        }

        for (const [index, pack] of packs.entries()) {
            const tab = index === 0 ? page : await page.context().newPage();
            if (index > 0) await tab.goto(designerUrl(pack.length));
            await importXml(tab, notmpcXml(pack, urls, cardBackFace(order).file), pack.length);
        }

        onProgress?.({ type: 'progress', done: faces.length, total: faces.length, message: `Sent ${packs.length} deck(s) to notmpc.eu` });
        return browser;
    } catch (error) {
        await browser.close();
        throw error;
    }
}

// Images on Google Drive go into the order file as links, which notmpc.eu loads itself, when they need no processing:
// no brightness or contrast of their own and the bleed in the image already.
export async function linkedImage(face: Face, height: number): Promise<string | undefined> {
    const id = face.source.type === 'mpcfill' ? face.source.id : face.source.type === 'cardback' ? face.source.driveId : undefined;
    if (!id || face.adjustments?.brightness !== 1 || face.adjustments.contrast !== 1) return undefined;

    const shape = await sharp(await downloadDriveImage(id, 200)).metadata();
    return hasBleed(shape.width, shape.height) ? driveImageUrl(id, height) : undefined;
}

// The designer's own upload with the nonce WordPress puts into the page; it works without an account.
export async function uploadImage(page: Page, file: string, onWait: (message: string) => void, signal?: AbortSignal): Promise<string> {
    const { url, nonce, language } = await page.evaluate('({ url: my_upload_ajax.ajax_url, nonce: my_upload_ajax.nonce, language: notmpcEuMarket.language })') as Record<string, string>;
    for (let pause = 1; ; pause++) {
        const response = await page.request.post(url!, {
            multipart: {
                'images[]': { name: path.basename(file), mimeType: 'image/jpeg', buffer: await readFile(file) },
                action: 'my_custom_ajax',
                method: 'upload',
                security: nonce!,
                language: language!
            }
        });

        if (response.status() === 429 && pause <= UPLOAD_PAUSES) {
            onWait(`notmpc.eu takes no more uploads for now, trying again in a minute (wait ${pause} of ${UPLOAD_PAUSES})`);
            await setTimeout(UPLOAD_PAUSE_MS, undefined, signal ? { signal } : {});
            continue;
        }

        const uploaded = await response.json().then(json => json?.success ? json.data?.[0] : undefined, () => undefined);
        if (!response.ok() || typeof uploaded !== 'string') {
            throw new Error(`notmpc.eu did not take ${path.basename(file)} (${response.status()}): ${await response.text()}`);
        }
        return uploaded;
    }
}

// The page opens with a dialog for an empty design; the XML import replaces it.
async function importXml(page: Page, xml: string, cards: number) {
    await page.locator('#popup .popup-close').click();
    await page.setInputFiles('#xmlUploader', { name: 'deck.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
    await page.locator('#drop_front .drop-zone').nth(cards - 1).waitFor();
}
