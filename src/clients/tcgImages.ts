import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Bottleneck from "bottleneck";
import { dataPath } from "../config/paths.js";
import { exists } from "../utils/fs.js";

// Orders come from files too, so their image URLs are only followed to these hosts.
const TCG_IMAGE_HOSTS = ['images.ygoprodeck.com', 'assets.tcgdex.net'];

// YGOPRODeck blacklists heavy image traffic and asks for each image to be downloaded once and kept.
const tcgImageBottleneck = new Bottleneck({
    maxConcurrent: 4,
    minTime: 100
});

const downloads = new Map<string, Promise<string>>();

export function tcgImageFile(url: string) {
    return dataPath('cache', 'tcg', `${createHash('sha1').update(url).digest('hex').slice(0, 16)}${path.extname(new URL(url).pathname)}`);
}

// The file of the card image, downloaded unless it is there; calls for the same image share the download.
export async function cacheTcgImage(url: string): Promise<string> {
    if (!TCG_IMAGE_HOSTS.includes(new URL(url).host)) throw new Error(`Card images only come from YGOPRODeck and TCGdex, not from ${url}`);
    const file = tcgImageFile(url);
    if (await exists(file)) return file;

    let download = downloads.get(file);
    if (!download) {
        download = (async () => {
            const response = await tcgImageBottleneck.schedule(() => fetch(url, { headers: { "User-Agent": "BlackLotusPress/1.0" } }));
            if (!response.ok) throw new Error(`Downloading ${url} failed (${response.status})`);
            await fs.mkdir(path.dirname(file), { recursive: true });
            // Written aside first, so a broken download never looks like a cached image.
            await fs.writeFile(`${file}.part`, Buffer.from(await response.arrayBuffer()));
            await fs.rename(`${file}.part`, file);
            return file;
        })().finally(() => downloads.delete(file));
        downloads.set(file, download);
    }
    return await download;
}
