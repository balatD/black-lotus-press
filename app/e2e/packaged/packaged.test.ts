import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

// The build of this platform, as electron-builder leaves it unpacked in release/.
const EXECUTABLES: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'release/mac-arm64/Black Lotus Press.app/Contents/MacOS/Black Lotus Press',
    win32: 'release/win-unpacked/Black Lotus Press.exe',
    linux: 'release/linux-unpacked/black-lotus-press'
};

let app: ElectronApplication;
let window: Page;
let userData: string;
const consoleErrors: string[] = [];

before(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'black-lotus-press-packaged-'));
    // On Linux runners chrome-sandbox is not owned by root, so Chromium's sandbox cannot start.
    const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
    app = await electron.launch({ executablePath: path.resolve(EXECUTABLES[process.platform]!), args: [`--user-data-dir=${userData}`, ...sandbox] });
    window = await app.firstWindow();
    window.on('console', message => message.type() === 'error' && consoleErrors.push(message.text()));
    await window.locator('.rail').waitFor();
});

after(async () => {
    await app?.close();
});

test('the packaged app starts with its window', async () => {
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(await window.title(), 'Black Lotus Press');
});

test('the packaged app runs the native image library', async () => {
    const images = path.join(userData, 'data', 'config', 'images');
    await fs.mkdir(images, { recursive: true });
    await sharp({ create: { width: 630, height: 880, channels: 3, background: '#3366aa' } }).png().toFile(path.join(images, 'smoke.png'));

    // Own images are previewed through sharp in the main process, as an image like in the app (its CSP allows no fetch).
    const width = await window.evaluate<number>(`new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth);
        image.onerror = () => resolve(0);
        image.src = 'preview://image/smoke.png';
    })`);

    assert.equal(width, 700, 'the preview is the 700 px JPEG sharp makes');
});

test('the packaged app logged no errors', () => {
    assert.deepEqual(consoleErrors, []);
});
