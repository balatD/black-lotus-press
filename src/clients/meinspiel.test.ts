import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { DefaultOrder, type Handover, type Order, type UploadedGame } from "../model.js";
import { buildPacks } from "../pipeline/packs.js";
import { setDataRoot } from "../config/paths.js";
import { finishUpload, type MeinspielSession, packRequests, postMultipart, settleSession, uploadMissingPacks, uploadToMeinspiel, waitForLogin } from "./meinspiel.js";

function fakeUpload() {
    const done = { closed: 0, opened: [] as string[] };
    let handover: Handover = { order: 'sauron', title: 'sauron to meinspiel.de', steps: [] };
    const window = { update: (change: (current: Handover) => Handover) => void (handover = change(handover)) };
    const session = {
        context: { close: async () => void done.closed++ },
        page: { context: () => ({ newPage: async () => ({ goto: async (url: string) => void done.opened.push(url) }) }), close: async () => {} }
    } as unknown as MeinspielSession;
    return { done, window, session, handover: () => handover };
}

const game = (id: number, saved: boolean): UploadedGame => ({ id, saved, name: `sauron - Deck ${id}/2`, url: `https://www.meinspiel.de/konfigurator/game/${id}?tid=17` });

test('finishUpload closes the browser once every game is saved and lists the games in the hand-over', async () => {
    const upload = fakeUpload();

    assert.equal(await finishUpload(upload.window, upload.session, [game(1, true), game(2, true)]), undefined);

    assert.deepEqual(upload.done, { closed: 1, opened: [] });
    assert.deepEqual(upload.handover().links, [
        { label: 'sauron - Deck 1/2', url: 'https://www.meinspiel.de/konfigurator/game/1?tid=17' },
        { label: 'sauron - Deck 2/2', url: 'https://www.meinspiel.de/konfigurator/game/2?tid=17' }
    ]);
    assert.match(upload.handover().next!, /saved in your meinspiel.de account/);
});

test('finishUpload keeps the browser open with the games that are not saved, which only it has', async () => {
    const upload = fakeUpload();

    assert.equal(await finishUpload(upload.window, upload.session, [game(1, true), game(2, false)]), upload.session);

    assert.deepEqual(upload.done, { closed: 0, opened: ['https://www.meinspiel.de/konfigurator/game/2?tid=17'] });
    assert.match(upload.handover().next!, /Speichern/);
});

// Cards with own images, so they print without a Scryfall printing.
function sauron(cards: number): Order {
    return { ...DefaultOrder, name: 'sauron', cardBack: 'drive1', cards: [{ id: 'a', deck: 'deck', board: 'mainboard', name: 'Sauron', quantity: cards, isToken: false, excluded: false, customImage: { front: 'a.png' } }] };
}

test('uploadMissingPacks goes on after the packs uploaded before and stops at a pack that fails, with the games made until then', async () => {
    const posted: string[] = [];
    const session = {
        page: { request: { post: async (_url: string, { data }: { data: { name: string } }) => {
            posted.push(data.name);
            return { ok: () => false, status: () => 502, text: async () => 'Bad Gateway' };
        } } }
    } as unknown as MeinspielSession;
    const order = sauron(60);

    const result = await uploadMissingPacks(session, order, buildPacks(order).packs, [game(1, true)], () => {});

    assert.deepEqual(posted, ['sauron - Deck 2/2']);
    assert.deepEqual(result.games, [game(1, true)]);
    assert.match(String(result.error), /Creating the game failed \(502\)/);
});

test('settleSession loads the login page until meinspiel.de stops giving the new session another id', async () => {
    // As measured: a new session changes its id on the first two loads, then keeps it.
    const ids = [undefined, 'ka8nov', 'atvaia', 'atvaia'];
    let loads = 0;
    const session = {
        context: { cookies: async () => { const id = ids.shift(); return id ? [{ name: 'PHPSESSID', value: id }] : []; } },
        page: { request: { get: async () => void loads++ } }
    } as unknown as MeinspielSession;

    await settleSession(session);

    assert.equal(loads, 3);
    assert.deepEqual(ids, []);
});

test('waitForLogin asks meinspiel.de only when a page has loaded, never while the login form is on its way', async () => {
    const users = [{ id: 0 }, { id: 1355825, username: 'dragan' }];
    const asked: string[] = [];
    const session = {
        page: {
            request: { get: async () => ({ json: async () => (asked.push('users'), users.shift()) }) },
            waitForEvent: async (event: string) => {
                asked.push(event);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    } as unknown as MeinspielSession;

    assert.equal(await waitForLogin(session), 'dragan');
    assert.deepEqual(asked, ['users', 'load', 'users']);
});

test('postMultipart sends the image as multipart with the browser headers and counts the bytes up to the whole body', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meinspiel-upload-'));
    const image = path.join(dir, 'card.png');
    await fs.writeFile(image, Buffer.alloc(300_000, 'i'));

    let received: { headers: http.IncomingHttpHeaders, body: Buffer } | undefined;
    const server = http.createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        received = { headers: request.headers, body: Buffer.concat(chunks) };
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"id":42}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/games/7/cards/100/layers/900100/image`;

    try {
        const sent: number[] = [];
        const response = await postMultipart(url, { cookie: 'PHPSESSID=abc', userAgent: 'Chrome' },
            [['imagefile[]', image]], (bytes, total) => sent.push(bytes, total));

        assert.deepEqual(response, { status: 200, body: '{"id":42}' });
        assert.equal(received!.headers.cookie, 'PHPSESSID=abc');
        assert.equal(received!.headers['user-agent'], 'Chrome');
        assert.equal(Number(received!.headers['content-length']), received!.body.length);
        const body = received!.body.toString('latin1');
        assert.match(body, /name="imagefile\[\]"; filename="card\.png"\r\nContent-Type: image\/png\r\n\r\ni{300000}\r\n--/);

        const counts = sent.filter((_, index) => index % 2 === 0);
        assert.ok(counts.length > 2, 'reports along the way');
        assert.ok(counts.every((count, index) => index === 0 || count >= counts[index - 1]!), 'never goes back');
        assert.equal(counts.at(-1), received!.body.length);
        assert.equal(sent[1], received!.body.length, 'the total is the whole body');
    } finally {
        server.close();
    }
});

// Shaped like the game meinspiel.de creates for template 17: fronts under p1000 and backs under p150, each with its image layer.
function createdGame(fronts = 55, backs = 55) {
    const byId: Record<string, { mainLayerId: string }> = {};
    const ids = (first: number, count: number) => Array.from({ length: count }, (_, index) => {
        const id = first + index;
        byId[`p${id}`] = { mainLayerId: `p${id + 900000}` };
        return `p${id}`;
    });
    return { id: 7, userId: 1355825, cards: { byIndex: { p1000: ids(100, fronts), p150: ids(200, backs) }, byId } };
}

const slots = (fronts: string[], backs: string[]) => fronts.map((front, index) => ({ front, back: backs[index]! }));
const times = (file: string, count: number) => Array<string>(count).fill(file);
const distinct = (count: number) => Array.from({ length: count }, (_, index) => `card-${index}.jpg`);

test('packRequests uploads a pack of distinct fronts card by card and its one card back once, copied to the other 54 backs', () => {
    const requests = packRequests(createdGame(), slots(distinct(55), times('cardback.jpg', 55)));

    const fronts = requests.filter(request => request.type === 'upload' && request.card < 200);
    assert.equal(fronts.length, 55);
    assert.deepEqual(fronts[0], { type: 'upload', card: 100, layer: 900100, file: 'card-0.jpg' });
    assert.deepEqual(requests.filter(request => request.card >= 200), [
        { type: 'upload', card: 200, layer: 900200, file: 'cardback.jpg' },
        { type: 'copyToNext', card: 200, count: 54 }
    ]);
});

test('packRequests copies repeated images to the next cards or, further on, from the first card that shows them', () => {
    const fronts = ['a.jpg', 'a.jpg', 'b.jpg', 'a.jpg', ...distinct(51)];
    // A double-faced card interrupts the card backs.
    const backs = [...times('cardback.jpg', 10), 'dfc-back.jpg', ...times('cardback.jpg', 44)];

    const requests = packRequests(createdGame(), slots(fronts, backs));

    assert.deepEqual(requests.slice(0, 4), [
        { type: 'upload', card: 100, layer: 900100, file: 'a.jpg' },
        { type: 'copyToNext', card: 100, count: 1 },
        { type: 'upload', card: 102, layer: 900102, file: 'b.jpg' },
        { type: 'copyFrom', card: 103, from: 100 }
    ]);
    assert.deepEqual(requests.filter(request => request.card >= 200), [
        { type: 'upload', card: 200, layer: 900200, file: 'cardback.jpg' },
        { type: 'copyToNext', card: 200, count: 9 },
        { type: 'upload', card: 210, layer: 900210, file: 'dfc-back.jpg' },
        { type: 'copyFrom', card: 211, from: 200 },
        { type: 'copyToNext', card: 211, count: 43 }
    ]);
});

test('packRequests refuses a game that has not a card for every slot of the pack', () => {
    assert.throws(() => packRequests(createdGame(54, 55), slots(distinct(55), times('cardback.jpg', 55))), /54 fronts for 55 cards/);
});

test('uploadToMeinspiel refuses an order with images that are not processed before it opens the browser', async () => {
    setDataRoot(await fs.mkdtemp(path.join(os.tmpdir(), 'meinspiel-upload-')));
    try {
        await assert.rejects(uploadToMeinspiel(sauron(55), [], undefined), /2 card image\(s\) are not processed yet/);
    } finally {
        setDataRoot(process.cwd());
    }
});

test('postMultipart waits for the connection without piling up listeners on a large image', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meinspiel-upload-'));
    const image = path.join(dir, 'card.png');
    await fs.writeFile(image, Buffer.alloc(4_000_000, 'i'));
    const server = http.createServer(async (request, response) => {
        for await (const _ of request) { /* reads everything */ }
        response.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.name);
    process.on('warning', onWarning);

    try {
        await postMultipart(`http://127.0.0.1:${(server.address() as AddressInfo).port}/image`, { cookie: '', userAgent: '' }, [['imagefile[]', image]], () => {});
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(warnings, []);
    } finally {
        process.off('warning', onWarning);
        server.close();
    }
});
