import fs from "node:fs/promises";
import path from "node:path";

// Google's image server scales the image down to the height as a JPEG of quality 100; smaller images come as they are.
export function driveImageUrl(id: string, height: number) {
    return `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=h${height}-l100`;
}

export async function downloadDriveImage(id: string, height?: number): Promise<Buffer> {
    const response = await fetch(height === undefined
        ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
        : driveImageUrl(id, height));
    const contentType = response.headers.get('content-type') ?? '';

    // Missing or private files come back as HTML pages, not as errors only.
    if (!response.ok || !contentType.startsWith('image/')) {
        throw new Error(`Google Drive image ${id} could not be downloaded (${response.status}, ${contentType}). Is it a public MPC Autofill image ID?`);
    }

    return Buffer.from(await response.arrayBuffer());
}

const downloads = new Map<string, Promise<void>>();

// Downloads the image into the file unless it is there; calls for the same file share the download.
export async function cacheDriveImage(id: string, height: number, file: string): Promise<void> {
    if (await fs.access(file).then(() => true, () => false)) return;

    let download = downloads.get(file);
    if (!download) {
        download = (async () => {
            const image = await downloadDriveImage(id, height);
            await fs.mkdir(path.dirname(file), { recursive: true });
            // Written aside first, so a broken download never looks like a cached image.
            await fs.writeFile(`${file}.part`, image);
            await fs.rename(`${file}.part`, file);
        })().finally(() => downloads.delete(file));
        downloads.set(file, download);
    }
    await download;
}
