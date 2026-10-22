import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { DefaultOrder, DefaultProfile } from "../../src/model.js";

// Starting and quitting the app, each with its own data root and app, apart from the smoke tests' app.
const MAIN = path.resolve('out/main/index.js');

let app: ElectronApplication;
let window: Page;
let root: string;

before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-forge-lifecycle-'));
    await fs.mkdir(path.join(root, 'config', 'orders'), { recursive: true });
    await fs.mkdir(path.join(root, 'config', 'profiles'), { recursive: true });
    await fs.writeFile(path.join(root, 'config', 'profiles', 'default.json'), JSON.stringify(DefaultProfile));
    await fs.writeFile(path.join(root, 'config', 'orders', 'good.json'), JSON.stringify({ ...DefaultOrder, name: 'good', cardBack: '' }));
    await fs.writeFile(path.join(root, 'config', 'orders', 'broken.json'), '{"name":');

    app = await electron.launch({ args: [MAIN], cwd: root });
    window = await app.firstWindow();
    await window.locator('.splash').waitFor();
    await window.keyboard.press('Escape');
    await window.locator('.shop-picker').getByRole('button', { name: 'meinspiel.de' }).click();
});

after(async () => {
    await app?.close().catch(() => {});
});

test('an order file that cannot be read is named and left as it is, and the other orders load', async () => {
    await window.getByRole('alert').filter({ hasText: 'broken.json' }).waitFor();
    await window.getByRole('button', { name: /^good/ }).waitFor();
    assert.equal(await fs.readFile(path.join(root, 'config', 'orders', 'broken.json'), 'utf-8'), '{"name":');
});

// Last, since it quits the app.
test('an edit made just before quitting is saved', async () => {
    // Playwright reports the held-back close as a dialog, which Electron never shows, so dismissing it fails.
    window.on('dialog', dialog => void dialog.dismiss().catch(() => {}));
    await window.getByRole('button', { name: /^good/ }).click();
    await window.locator('#card-back').fill('edited-before-quitting');
    const closed = app.waitForEvent('close');
    await app.evaluate(({ app }) => app.quit());
    await closed;

    const saved = JSON.parse(await fs.readFile(path.join(root, 'config', 'orders', 'good.json'), 'utf-8'));
    assert.equal(saved.cardBack, 'edited-before-quitting');
});
