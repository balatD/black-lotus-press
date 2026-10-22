import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Handover, UploadedGame } from "../model.js";
import { finishUpload, type MeinspielSession, postMultipart, settleSession, waitForLogin } from "./meinspiel.js";

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

const game = (id: number, saved: boolean): UploadedGame => ({ id, saved, name: `sauron - Deck ${id}/2`, url: `https://www.meinspiel.de/konfigurator/game/${id}?tid=10098` });

test('finishUpload closes the browser once every game is saved and lists the games in the hand-over', async () => {
    const upload = fakeUpload();

    assert.equal(await finishUpload(upload.window, upload.session, [game(1, true), game(2, true)]), undefined);

    assert.deepEqual(upload.done, { closed: 1, opened: [] });
    assert.deepEqual(upload.handover().links, [
        { label: 'sauron - Deck 1/2', url: 'https://www.meinspiel.de/konfigurator/game/1?tid=10098' },
        { label: 'sauron - Deck 2/2', url: 'https://www.meinspiel.de/konfigurator/game/2?tid=10098' }
    ]);
    assert.match(upload.handover().next!, /saved in your meinspiel.de account/);
});

test('finishUpload keeps the browser open with the games that are not saved, which only it has', async () => {
    const upload = fakeUpload();

    assert.equal(await finishUpload(upload.window, upload.session, [game(1, true), game(2, false)]), upload.session);

    assert.deepEqual(upload.done, { closed: 0, opened: ['https://www.meinspiel.de/konfigurator/game/2?tid=10098'] });
    assert.match(upload.handover().next!, /Speichern/);
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

test('postMultipart sends the files as multipart with the browser headers and counts the bytes up to the whole body', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meinspiel-upload-'));
    const fronts = path.join(dir, 'pack-01-fronts.pdf');
    const backs = path.join(dir, 'pack-01-backs.pdf');
    await fs.writeFile(fronts, Buffer.alloc(300_000, 'f'));
    await fs.writeFile(backs, Buffer.alloc(200_000, 'b'));

    let received: { headers: http.IncomingHttpHeaders, body: Buffer } | undefined;
    const server = http.createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        received = { headers: request.headers, body: Buffer.concat(chunks) };
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"id":42}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/games/7/pdf/async`;

    try {
        const sent: number[] = [];
        const response = await postMultipart(url, { cookie: 'PHPSESSID=abc', userAgent: 'Chrome' },
            [['pdf_front_sides', fronts], ['pdf_back_sides', backs]], (bytes, total) => sent.push(bytes, total));

        assert.deepEqual(response, { status: 200, body: '{"id":42}' });
        assert.equal(received!.headers.cookie, 'PHPSESSID=abc');
        assert.equal(received!.headers['user-agent'], 'Chrome');
        assert.equal(Number(received!.headers['content-length']), received!.body.length);
        const body = received!.body.toString('latin1');
        assert.match(body, /name="pdf_front_sides"; filename="pack-01-fronts\.pdf"\r\nContent-Type: application\/pdf\r\n\r\nf{300000}\r\n/);
        assert.match(body, /name="pdf_back_sides"; filename="pack-01-backs\.pdf"\r\nContent-Type: application\/pdf\r\n\r\nb{200000}\r\n--/);

        const counts = sent.filter((_, index) => index % 2 === 0);
        assert.ok(counts.length > 2, 'reports along the way');
        assert.ok(counts.every((count, index) => index === 0 || count >= counts[index - 1]!), 'never goes back');
        assert.equal(counts.at(-1), received!.body.length);
        assert.equal(sent[1], received!.body.length, 'the total is the whole body');
    } finally {
        server.close();
    }
});
