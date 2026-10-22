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
    const printerstudioOrder = { ...DefaultOrder, name: 'studio deck', shop: 'printerstudio', cardBack: '', cards: [card('a', 55)] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'studio deck.json'), JSON.stringify(printerstudioOrder));
    const travelOrder = { ...DefaultOrder, name: 'travel deck', cardBack: '', cards: [card('a', 3)] };
    // 52 cards and a token leave two slots of the pack blank.
    const tokenOrder = { ...DefaultOrder, name: 'token deck', cardBack: '', cards: [card('a', 52), { ...card('b', 1), id: 't', name: 'Treasure', board: 'tokens', isToken: true }] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'token deck.json'), JSON.stringify(tokenOrder));
    // A token added in the app belongs to no deck.
    // 50 cards and two tokens leave three slots of the pack blank.
    const fillOrder = { ...DefaultOrder, name: 'fill deck', cardBack: '', cards: [card('a', 50),
        { ...card('b', 1), id: 't1', name: 'Treasure', board: 'tokens', isToken: true }, { ...card('b', 1), id: 't2', name: 'Clue', board: 'tokens', isToken: true }] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'fill deck.json'), JSON.stringify(fillOrder));
    const filterOrder = { ...DefaultOrder, name: 'filter deck', cardBack: '', cards: [card('a', 2),
        { ...card('b', 1), id: 'treasure', name: 'Treasure', board: 'tokens', isToken: true },
        { ...card('a', 1), id: 'off', name: 'Off card', excluded: true },
        { ...card('c', 1), customImage: undefined, printing: { ...pricedPrinting('c', '1.00'), image_status: 'lowres' } }] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'filter deck.json'), JSON.stringify(filterOrder));
    // Own images on both faces and a full pack, so it prints without a card back or blank cards.
    const oneClickOrder = { ...DefaultOrder, name: 'one click deck', cardBack: '', cards: [{ ...card('a', 55), customImage: { front: 'a.png', back: 'b.png' } }] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'one click deck.json'), JSON.stringify(oneClickOrder));
    const addedOrder = { ...DefaultOrder, name: 'added deck', cardBack: '', cards: [card('a', 3), { ...card('b', 1), id: 'clue', name: 'Clue', deck: '', board: 'tokens', isToken: true }] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'added deck.json'), JSON.stringify(addedOrder));
    await fs.writeFile(path.join(root, 'config', 'orders', 'travel deck.json'), JSON.stringify(travelOrder));
    // Processed, so the order can be saved as an MPC Autofill XML.
    const xmlOrder = { ...DefaultOrder, name: 'xml deck', shop: 'printerstudio' as const, cardBack: '', cards: [card('a', 2)] };
    await fs.writeFile(path.join(root, 'config', 'orders', 'xml deck.json'), JSON.stringify(xmlOrder));
    const xmlFaces = cardFaces(xmlOrder.cards[0]!, xmlOrder)!;
    const xmlCards = path.join(root, 'orders', 'xml deck', 'cards');
    await fs.mkdir(xmlCards, { recursive: true });
    await fs.writeFile(path.join(xmlCards, 'cache.json'), JSON.stringify({ settings: settingsFingerprint(DefaultProfile) }));
    for (const file of [xmlFaces.front.base!, xmlFaces.front.file, xmlFaces.back.base!, xmlFaces.back.file]) {
        await sharp({ create: { width: 815, height: 1110, channels: 3, background: '#3366aa' } }).jpeg().toFile(path.join(xmlCards, file));
    }
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
    // A pending save holds back the close, which Playwright reports as a dialog Electron never shows.
    window?.on('dialog', dialog => void dialog.dismiss().catch(() => {}));
    await app?.close();
});

test('the order list shows the order with its pack count', async () => {
    const item = window.getByRole('button', { name: /test/ });
    await item.waitFor();

    assert.match(await item.innerText(), /1 pack/);
});

test('the order list finds orders by name', async () => {
    const search = window.getByPlaceholder('Find an order');
    await search.fill('deck');
    await window.getByRole('button', { name: /travel deck/ }).waitFor();
    assert.equal(await window.getByRole('button', { name: /^test/ }).count(), 0);

    await search.fill('');
    await window.getByRole('button', { name: /^test/ }).waitFor();
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

test('the images that failed to process are marked on the sheet and can be tried again', async () => {
    // The order has no card back, so its image fails to process.
    await window.getByRole('tab', { name: 'Backs' }).click();
    const failed = window.locator('.sheet .slot.failed .slot-button');
    await failed.first().waitFor();
    assert.match(await failed.first().getAttribute('title') ?? '', /card back/);

    await window.getByRole('button', { name: 'Retry the failed images' }).click();
    await window.getByRole('button', { name: 'Process all again' }).waitFor({ timeout: 60000 });
    await failed.first().waitFor();
    await window.getByRole('tab', { name: 'Fronts' }).click();
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

test('notmpc.eu cannot be chosen while it is not available, and its orders stay out of sight', async () => {
    await window.getByRole('button', { name: 'Switch print shop' }).click();
    const notmpc = window.locator('.shop-picker').getByRole('button', { name: /notmpc\.eu/ });

    assert.equal(await notmpc.isDisabled(), true);
    assert.match(await notmpc.innerText(), /Not available at the moment/);

    await chooseShop('meinspiel.de');
    await window.getByRole('button', { name: /^test/ }).waitFor();
    assert.equal(await window.getByRole('button', { name: /eu deck/ }).count(), 0);
});

test('printerstudio.de orders come in its deck sizes, with the way to send them', async () => {
    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('printerstudio.de');

    await window.getByRole('button', { name: /studio deck/ }).click();
    await window.getByText(/55 cards fill 1 deck of up to 72/).waitFor();
    await window.getByRole('tab', { name: 'Print' }).click();
    await window.getByRole('button', { name: 'Send to printerstudio.de' }).waitFor();
    assert.equal(await window.getByRole('button', { name: /eu deck/ }).count(), 0);

    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('meinspiel.de');
    await window.getByRole('button', { name: /test/ }).waitFor();
});

test('an order moves to another shop and is copied back, and opens there each time', async () => {
    await window.getByRole('button', { name: /travel deck/ }).click();
    const dialog = window.locator('.transfer-dialog');

    await window.getByRole('button', { name: 'Move or copy' }).click();
    assert.equal(await dialog.getByRole('button', { name: 'notmpc.eu', exact: true }).count(), 0, 'notmpc.eu is not available');
    await dialog.getByRole('button', { name: 'Move to printerstudio.de' }).click();
    await dialog.waitFor({ state: 'detached' });
    await window.getByText('Print files for printerstudio.de').waitFor();
    await window.getByRole('heading', { name: 'travel deck' }).waitFor();

    await window.getByRole('button', { name: 'Move or copy' }).click();
    assert.equal(await dialog.getByLabel('Name of the copy').inputValue(), 'travel deck meinspiel.de');
    await dialog.getByLabel('Name of the copy').fill('eu deck');
    await dialog.getByText('An order with this name exists already for notmpc.eu.').waitFor();
    await dialog.getByLabel('Name of the copy').fill('travel copy');
    await dialog.getByRole('button', { name: 'Copy to meinspiel.de' }).click();
    await window.getByText('Print files for meinspiel.de').waitFor();
    await window.getByRole('heading', { name: 'travel copy' }).waitFor();
    assert.equal(await window.getByRole('button', { name: /travel deck/ }).count(), 0);

    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('printerstudio.de');
    await window.getByRole('button', { name: /travel deck/ }).waitFor();
    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('meinspiel.de');
    await window.getByRole('button', { name: /^test/ }).waitFor();
});

test('the print tab saves the order as an MPC Autofill XML that points to the processed images', async () => {
    const target = path.join(root, 'saved.xml');
    await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    }, target);
    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('printerstudio.de');
    await window.getByRole('button', { name: /xml deck/ }).click();
    await window.getByRole('tab', { name: 'Print' }).click();

    await window.getByRole('button', { name: 'Save MPC Autofill XML' }).click();

    await window.getByText(`Saved as ${target}`).waitFor();
    const xml = await fs.readFile(target, 'utf-8');
    // The app may name the temp folder differently: /private/var for /var on macOS, a short 8.3 name on Windows.
    const front = path.join(root, 'orders', 'xml deck', 'cards', cardFaces(card('a', 2), DefaultOrder)!.front.file);
    assert.match(xml, /<quantity>2<\/quantity>/);
    const id = xml.match(/<card><id>([^<]+)<\/id><slots>0,1<\/slots>/)?.[1];
    assert.ok(id, xml);
    assert.equal(await fs.realpath(id), await fs.realpath(front));
    assert.ok(!xml.includes('<backs>'), 'every card has the card back');

    await window.getByRole('button', { name: 'Switch print shop' }).click();
    await chooseShop('meinspiel.de');
    await window.getByRole('button', { name: /^test/ }).waitFor();
});

test('the cards tab tells of the blank slots of a pack and fills them with copies of the tokens', async () => {
    await window.getByRole('button', { name: /token deck/ }).click();
    await window.getByRole('tab', { name: 'Cards' }).click();
    await window.getByText('2 slots stay blank. Fill them with tokens:').waitFor();

    await window.getByRole('button', { name: 'Add a copy of Treasure' }).click();
    await window.getByText('1 slot stays blank. Fill it with tokens:').waitFor();

    await window.getByRole('button', { name: 'Find a token…' }).click();
    const finder = window.getByRole('dialog', { name: 'Tokens from Scryfall' });
    await finder.getByRole('searchbox', { name: 'Name of the token' }).waitFor();
    await finder.getByRole('button', { name: 'Close' }).click();
    await finder.waitFor({ state: 'detached' });

    await window.getByRole('button', { name: 'Add a copy of Treasure' }).click();
    await window.getByText('55 cards fill 1 pack of 55', { exact: false }).waitFor();
    assert.equal(await window.getByText(/stays? blank/).count(), 0);
    assert.equal(await window.getByRole('spinbutton', { name: 'Copies of Treasure' }).inputValue(), '3');
});

test('a card added in the app can be removed from the order, an imported card only switched off', async () => {
    await window.getByRole('button', { name: /added deck/ }).click();
    await window.getByRole('tab', { name: 'Cards' }).click();
    await window.getByRole('button', { name: 'List', exact: true }).click();
    const editor = window.locator('.card-editor');

    await window.locator('.card-row', { hasText: 'Card a' }).locator('.card-name').click();
    await editor.waitFor();
    assert.equal(await editor.getByRole('button', { name: 'Remove from the order' }).count(), 0);
    await window.keyboard.press('Escape');
    await editor.waitFor({ state: 'detached' });

    await window.locator('.card-row', { hasText: 'Clue' }).locator('.card-name').click();
    window.once('dialog', dialog => void dialog.accept());
    await editor.getByRole('button', { name: 'Remove from the order' }).click();
    await editor.waitFor({ state: 'detached' });
    assert.deepEqual(await window.locator('.card-row .card-name .name').allTextContents(), ['Card a']);
});

test('one click fills all blank slots of the pack with copies of the tokens', async () => {
    await window.getByRole('button', { name: /fill deck/ }).click();
    await window.getByRole('tab', { name: 'Cards' }).click();
    await window.getByRole('button', { name: 'List', exact: true }).click();
    await window.getByText('3 slots stay blank.', { exact: false }).waitFor();

    await window.getByRole('button', { name: 'Fill all blank slots' }).click();
    await window.getByText('55 cards fill 1 pack of 55', { exact: false }).waitFor();
    assert.equal(await window.getByRole('spinbutton', { name: 'Copies of Treasure' }).inputValue(), '3');
    assert.equal(await window.getByRole('spinbutton', { name: 'Copies of Clue' }).inputValue(), '2');
});

test('the cards tab shows only the cards of one kind, together with the name search', async () => {
    await window.getByRole('button', { name: /filter deck/ }).click();
    await window.getByRole('tab', { name: 'Cards' }).click();
    await window.getByRole('button', { name: 'List', exact: true }).click();
    const names = () => window.locator('.card-row .card-name .name').allTextContents();
    const search = window.getByPlaceholder('Find a card by name');

    await window.getByRole('button', { name: 'Switched off (1)' }).click();
    assert.deepEqual(await names(), ['Off card']);
    assert.ok(await window.getByRole('button', { name: 'Move Off card' }).isDisabled());

    await window.getByRole('button', { name: 'Low-res (1)' }).click();
    assert.deepEqual(await names(), ['Card c']);
    await search.fill('Card a');
    assert.deepEqual(await names(), []);

    await window.getByRole('button', { name: /^All/ }).click();
    assert.deepEqual(await names(), ['Card a']);
    await search.fill('');
    assert.deepEqual(await names(), ['Card a', 'Treasure', 'Off card', 'Card c']);
    assert.ok(await window.getByRole('button', { name: 'Move Card a' }).isEnabled());
});

test('one click processes the missing images and builds the PDFs', async () => {
    await window.getByRole('button', { name: /one click deck/ }).click();
    await window.getByRole('tab', { name: 'Print' }).click();

    await window.getByRole('button', { name: 'Process images and build PDFs' }).click();
    await window.getByText(/^Pack 1:/).waitFor({ timeout: 120000 });
    await window.getByRole('button', { name: 'Build PDFs', exact: true }).waitFor();
});

test('the window logged no errors', () => {
    assert.deepEqual(consoleErrors, []);
});
