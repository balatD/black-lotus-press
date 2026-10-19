import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { DeckData, DefaultOrder, DefaultProfile, type OrderCard, type ScryfallCard } from "../../src/model.js";
import { cardFaces } from "../../src/pipeline/packs.js";
import { settingsFingerprint } from "../../src/pipeline/processImages.js";

const MAIN = path.resolve('out/main/index.js');

let app: ElectronApplication;
let window: Page;
let root: string;
const consoleErrors: string[] = [];

function card(id: string, quantity: number): OrderCard {
    return { id, deck: 'https://moxfield.com/decks/test', board: 'mainboard', name: `Card ${id}`, quantity, isToken: false, excluded: false, customImage: { front: `${id}.png` } };
}

// A data URL, because the card editor shows the scans and a scan that fails to load logs an error.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function pricedPrinting(id: string, eur: string): ScryfallCard {
    return {
        id, name: `Card ${id}`, set: 'tst', collector_number: '1', lang: 'en', full_art: false, frame: '2015', type_line: 'Artifact', layout: 'normal',
        image_uris: { small: PIXEL, normal: PIXEL, large: PIXEL, png: PIXEL, art_crop: PIXEL, border_crop: PIXEL }, prices: { eur }
    };
}

// The unpackaged app uses its working folder as data root, so a temp folder isolates the test.
before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-forge-e2e-'));
    const order = {
        ...DefaultOrder,
        name: 'test',
        cardBack: '',
        decks: [{ url: 'https://moxfield.com/decks/test', data: [DeckData.MainBoard], name: 'Test deck' }],
        cards: [{ ...card('a', 30), printing: pricedPrinting('a', '2.00') }, card('b', 20)],
        uploaded: { at: '2026-10-08T12:00:00.000Z', games: [{ id: 123, name: 'test - Deck 1/1', saved: true, url: 'https://www.meinspiel.de/konfigurator/game/123?tid=10098' }] }
    };
    await fs.mkdir(path.join(root, 'config', 'orders'), { recursive: true });
    await fs.mkdir(path.join(root, 'config', 'profiles'), { recursive: true });
    await fs.writeFile(path.join(root, 'config', 'orders', 'test.json'), JSON.stringify(order));
    const notmpcOrder = { ...DefaultOrder, name: 'eu deck', shop: 'notmpc', cardBack: '', cards: [card('a', 60)] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'eu deck.json'), JSON.stringify(notmpcOrder));
    await fs.writeFile(path.join(root, 'config', 'profiles', 'default.json'), JSON.stringify(DefaultProfile));
    await fs.mkdir(path.join(root, 'config', 'images'), { recursive: true });
    for (const id of ['a', 'b']) {
        await sharp({ create: { width: 630, height: 880, channels: 3, background: '#3366aa' } }).png().toFile(path.join(root, 'config', 'images', `${id}.png`));
    }

    // Processing works offline with the colour profile of the project folder, where it exists.
    const icc = path.resolve('config/icc/ISOcoated_v2_300_eci.icc');
    if (await fs.stat(icc).catch(() => undefined)) {
        await fs.mkdir(path.join(root, 'config', 'icc'), { recursive: true });
        await fs.copyFile(icc, path.join(root, 'config', 'icc', path.basename(icc)));
    }

    // The front of card a counts as processed, so the sheet has processed and unprocessed slots.
    const front = cardFaces(order.cards[0]!, order)!.front;
    const cards = path.join(root, 'orders', 'test', 'cards');
    await fs.mkdir(cards, { recursive: true });
    await fs.writeFile(path.join(cards, 'cache.json'), JSON.stringify({ settings: settingsFingerprint(DefaultProfile) }));
    for (const file of [front.base!, front.file]) {
        await sharp({ create: { width: 815, height: 1110, channels: 3, background: '#3366aa' } }).jpeg().toFile(path.join(cards, file));
    }

    app = await electron.launch({ args: [MAIN], cwd: root });
    window = await app.firstWindow();
    window.on('console', message => message.type() === 'error' && consoleErrors.push(message.text()));
    // The layout depends on the window size, which runners with small screens would shrink.
    await window.setViewportSize({ width: 1400, height: 900 });
    await window.locator('.rail').waitFor();
    // View settings live in the shared browser storage of the app, so earlier runs must not leak in.
    await window.evaluate(() => localStorage.clear());
    await window.reload();
    await skipSplash();
    await chooseShop('meinspiel.de');
});

// A key skips the splash at any moment; a click misses once it fades, which slow runners can reach first.
async function skipSplash() {
    await window.locator('.splash').waitFor();
    await window.keyboard.press('Escape');
    await window.locator('.splash').waitFor({ state: 'detached' });
}

async function chooseShop(name: string) {
    await window.locator('.shop-picker').getByRole('button', { name }).click();
    await window.locator('.shop-picker').waitFor({ state: 'detached' });
}

test('the splash screen shows the press card and gives way to the choice of shop', async () => {
    await window.reload();
    await window.getByText('Black Lotus Press', { exact: true }).first().waitFor();
    await window.locator('.splash-hero').waitFor();
    await skipSplash();
    await chooseShop('meinspiel.de');
});

after(async () => {
    await app?.close();
});

test('the order list shows the order with its pack count', async () => {
    const item = window.getByRole('button', { name: /test/ });
    await item.waitFor();

    assert.match(await item.innerText(), /1 pack/);
});

test('opening an order shows its cards with a summary', async () => {
    await window.getByRole('button', { name: /test/ }).click();

    await window.getByText(/50 cards fill 1 pack of 55/).waitFor();
    assert.equal(await window.locator('.card-row').count(), 2);
});

test('the summary strikes out what the printed cards are worth before the pack price', async () => {
    // Amounts are written in the system's locale, e.g. "60,00 €" or "€60.00".
    const [value, pack] = await window.evaluate(() => [60, 19.95].map(amount => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(amount)));

    assert.equal((await window.locator('.summary .headline').innerText()).replace(/\s/g, ' '), `50 cards fill 1 pack of 55, about ${value} ${pack} plus shipping.`.replace(/\s/g, ' '));
    assert.equal(await window.locator('.summary .headline s').innerText(), value);
});

test('switching a card off updates the summary', async () => {
    await window.locator('.card-row', { hasText: 'Card b' }).getByLabel('Print').uncheck();

    await window.getByText(/30 cards fill 1 pack of 55/).waitFor();
    await window.getByText('1 card is switched off.').waitFor();
});

test('the cards can be shown as a zoomable grid', async () => {
    await window.getByRole('button', { name: 'Cards', exact: true }).click();
    assert.equal(await window.locator('.card-grid .card-tile').count(), 2);

    const width = () => window.locator('.card-tile').first().evaluate(tile => tile.getBoundingClientRect().width);
    const before = await width();
    await window.getByRole('button', { name: 'Bigger cards' }).click();
    assert.ok(await width() > before, 'the cards get bigger');

    await window.getByRole('button', { name: 'List', exact: true }).click();
    await window.locator('.card-list').waitFor();
});

test('a card opens in the card editor, which steps through the cards', async () => {
    await window.getByRole('button', { name: 'Cards', exact: true }).click();
    await window.locator('.card-tile .tile-image').first().click();
    const editor = window.locator('.card-editor');
    await editor.getByRole('heading', { name: 'Card a' }).waitFor();

    assert.equal(await editor.getByRole('button', { name: 'Own image', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await editor.locator('.stage-frame img').first().getAttribute('src') ?? '', /^preview:\/\/image\/a\.png/);

    await window.keyboard.press('PageDown');
    await editor.getByRole('heading', { name: 'Card b' }).waitFor();
    await editor.getByRole('button', { name: 'Previous card' }).click();
    await editor.getByRole('heading', { name: 'Card a' }).waitFor();

    await window.keyboard.press('Escape');
    await editor.waitFor({ state: 'detached' });
    await window.getByRole('button', { name: 'List', exact: true }).click();
});

test('the card editor compares the image with the Scryfall scan', async () => {
    await window.locator('.card-row', { hasText: 'Card a' }).locator('.card-name').click();
    const editor = window.locator('.card-editor');
    await editor.getByRole('button', { name: 'Printings', exact: true }).click();

    await window.keyboard.press('c');

    await editor.locator('.stage-frame').nth(1).waitFor();
    assert.equal(await editor.locator('.stage-frame').count(), 2);
    await window.keyboard.press('Escape');
    await editor.waitFor({ state: 'detached' });
});

test('the print tab shows the pack as a sheet of 55 cards', async () => {
    await window.getByRole('tab', { name: 'Print' }).click();

    await window.getByText('1 of 3 images are ready (300 dpi, no upscaling).').waitFor();
    assert.equal(await window.locator('.sheet .slot').count(), 55);
    assert.equal(await window.locator('.sheet .slot.blank').count(), 25);
});

test('the brightness slider changes the sheet preview right away, also of processed cards', async () => {
    const image = window.locator('.sheet .slot img').first();
    const filter = () => image.evaluate(image => image.style.filter);
    assert.match(await image.getAttribute('src') ?? '', /\/base-/);
    assert.match(await filter(), /brightness\(1\.1\)/);

    await window.getByRole('slider', { name: /Brightness/ }).fill('125');

    for (let attempt = 0; attempt < 20 && !(await filter()).includes('brightness(1.25)'); attempt++) await window.waitForTimeout(100);
    assert.match(await filter(), /brightness\(1\.25\)/);
});

test('a card of the sheet opens large with front and back', async () => {
    await window.locator('.sheet .slot-button').first().click();

    await window.getByText('Card 1 of 55 in pack 1, brightness 125 %, contrast 100 %').waitFor();
    assert.equal(await window.locator('.slot-faces figure').count(), 2);
    await window.keyboard.press('Escape');
});

test('a processed card can be processed again from its large view', async () => {
    await window.locator('.sheet .slot-button').first().click();
    const front = window.locator('.slot-dialog .slot-faces figure').first();
    const src = () => front.locator('img').getAttribute('src');
    const before = await src();
    assert.match(before ?? '', /base-custom-a\.jpg/);

    await front.getByRole('button', { name: 'Process again' }).click();

    for (let attempt = 0; attempt < 120 && (await src() === before || !(await src())?.includes('base-custom-a.jpg')); attempt++) await window.waitForTimeout(500);
    assert.notEqual(await src(), before, 'the large view shows the new image');
    await front.getByRole('button', { name: 'Process again' }).waitFor();
    await window.keyboard.press('Escape');
});

test('all images of the order can be processed again at once', async () => {
    const base = path.join(root, 'orders', 'test', 'cards', 'base-custom-a.jpg');
    const before = (await fs.stat(base)).mtimeMs;
    window.once('dialog', dialog => void dialog.accept());

    await window.getByRole('button', { name: 'Process all again' }).click();

    const modified = async () => (await fs.stat(base).catch(() => undefined))?.mtimeMs ?? before;
    for (let attempt = 0; attempt < 120 && await modified() === before; attempt++) await window.waitForTimeout(500);
    assert.ok(await modified() > before, 'the base image was made anew');
    await window.getByRole('button', { name: 'Process all again' }).waitFor({ timeout: 60000 });
});

test('the print tab links the decks of the last upload on meinspiel.de', async () => {
    const link = window.getByRole('link', { name: 'test - Deck 1/1' });

    assert.equal(await link.getAttribute('href'), 'https://www.meinspiel.de/konfigurator/game/123?tid=10098');
    assert.equal(await window.getByRole('link', { name: 'your meinspiel.de account' }).getAttribute('href'), 'https://www.meinspiel.de/mein-konto');
});

test('the setup tab shows the deck', async () => {
    await window.getByRole('tab', { name: 'Setup' }).click();

    await window.getByRole('heading', { name: 'test' }).waitFor();
    await window.getByText('Test deck').waitFor();
    assert.equal(await window.getByLabel('MPC Autofill card back ID').inputValue(), '');
});

test('the profiles screen lists the profile', async () => {
    await window.getByRole('button', { name: 'Processing profiles' }).click();

    await window.getByRole('tab', { name: 'default' }).waitFor();
    assert.equal(await window.getByLabel('Resolution', { exact: true }).inputValue(), '300');
});

test('another shop lists only its own orders, in decks with the way to send them', async () => {
    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('notmpc.eu');

    const item = window.getByRole('button', { name: /eu deck/ });
    assert.match(await item.innerText(), /1 deck/);
    assert.equal(await window.getByRole('button', { name: /^test/ }).count(), 0);

    await item.click();
    await window.getByText(/60 cards fill 1 deck of up to 72/).waitFor();
    await window.getByRole('tab', { name: 'Print' }).click();
    assert.equal(await window.locator('.sheet .slot').count(), 60);
    await window.getByRole('button', { name: 'Send to notmpc.eu' }).waitFor();
    assert.equal(await window.getByRole('button', { name: 'Build PDFs' }).count(), 0);

    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('meinspiel.de');
    await window.getByRole('button', { name: /test/ }).waitFor();
});

test('the window logged no errors', () => {
    assert.deepEqual(consoleErrors, []);
});
