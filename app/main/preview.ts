import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { loadOrder } from "../../src/config/orderConfigManager.js";
import { cacheDriveImage } from "../../src/clients/googleDrive.js";
import { cardsDir, customImagePath, dataPath } from "../../src/config/paths.js";
import { isValidOrderName } from "../../src/model.js";
import { pageSizeInPixels, PREVIEW_DIR, writePreview } from "../../src/output/printImage.js";

const SAFE_FILE = /^[\w.-]+$/;
const DRIVE_ID = /^[\w-]+$/;
// Twice the pixels of a Scryfall scan, as many as printing at 600 dpi uses.
const MPCFILL_HEIGHT = pageSizeInPixels(600).height;
const pending = new Map<string, Promise<void>>();

// Must run before the app is ready.
export function registerPreviewScheme() {
    protocol.registerSchemesAsPrivileged([{ scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

// preview://order/<order name>/<file> shows a processed card, preview://image/<file> an own image,
// preview://mpcfill/<Drive id> an MPC Autofill image in high resolution.
export function handlePreviews() {
    protocol.handle('preview', async request => {
        try {
            const url = new URL(request.url);
            if (url.host === 'mpcfill') return await mpcfillImage(url);

            const source = await previewSource(url);
            if (!source) return new Response('Not found', { status: 404 });

            const preview = path.join(path.dirname(source), PREVIEW_DIR, `${path.parse(source).name}.jpg`);
            await ensurePreview(source, preview);
            return net.fetch(pathToFileURL(preview).toString());
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
}

async function mpcfillImage({ pathname }: URL) {
    // The id is in the path, because the host is lower-cased and Drive ids are not.
    const id = decodeURIComponent(pathname.slice(1));
    if (!DRIVE_ID.test(id)) return new Response('Not found', { status: 404 });

    const file = dataPath('cache', 'mpcfill', `${id}-h${MPCFILL_HEIGHT}.jpg`);
    await cacheDriveImage(id, MPCFILL_HEIGHT, file);
    return net.fetch(pathToFileURL(file).toString());
}

async function previewSource({ host, pathname }: URL) {
    const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (host === 'order' && segments.length === 2) {
        const [name, file] = segments as [string, string];
        if (!isValidOrderName(name) || !SAFE_FILE.test(file)) return undefined;
        return path.join(cardsDir(await loadOrder(name)), file);
    }

    if (host === 'image' && segments.length === 1 && SAFE_FILE.test(segments[0]!)) {
        return customImagePath(segments[0]!);
    }

    return undefined;
}

async function ensurePreview(source: string, preview: string) {
    const [sourceStat, previewStat] = await Promise.all([fs.stat(source), fs.stat(preview).catch(() => undefined)]);
    if (previewStat && previewStat.mtimeMs >= sourceStat.mtimeMs) return;

    let job = pending.get(preview);
    if (!job) {
        job = fs.mkdir(path.dirname(preview), { recursive: true })
            .then(() => writePreview(source, preview))
            .finally(() => pending.delete(preview));
        pending.set(preview, job);
    }
    await job;
}
