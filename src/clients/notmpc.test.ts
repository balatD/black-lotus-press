import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Page } from "playwright";
import { linkedImage, uploadImage } from "./notmpc.js";
import type { Face } from "../pipeline/packs.js";

afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
});

test('uploadImage waits when notmpc.eu takes no more uploads for a while and then tries again', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'notmpc-')), 'card.jpg');
    await fs.writeFile(file, 'jpeg');
    const statuses = [429, 200];
    const page = {
        evaluate: async () => ({ url: 'https://notmpc.eu/wp-admin/admin-ajax.php', nonce: 'nonce', language: 'de' }),
        request: {
            post: async () => {
                const status = statuses.shift()!;
                const body = status === 200
                    ? { success: true, data: ['https://notmpc.eu/tmp/img_card.jpg'] }
                    : { success: false, data: { message: 'Zu viele Uploads. Bitte warten Sie einige Minuten und versuchen Sie es erneut.' } };
                return { status: () => status, ok: () => status === 200, json: async () => body, text: async () => JSON.stringify(body) };
            }
        }
    } as unknown as Page;
    mock.timers.enable({ apis: ['setTimeout'] });
    const waits: string[] = [];

    const upload = uploadImage(page, file, message => waits.push(message));
    while (waits.length === 0) await new Promise(resolve => setImmediate(resolve));
    mock.timers.tick(60_000);

    assert.equal(await upload, 'https://notmpc.eu/tmp/img_card.jpg');
    assert.equal(waits.length, 1);
    assert.deepEqual(statuses, []);
});

test('linkedImage links MPC Autofill images and card backs with bleed and without adjustments, at the height of the print', async () => {
    // 816 × 1110 and 750 × 1048 pixels, scaled to the 200 pixels the check asks for.
    const shapes: Record<string, [number, number]> = { page: [147, 200], card: [143, 200] };
    mock.method(globalThis, 'fetch', async (url: string) => {
        const [width, height] = shapes[url.includes('/card=') ? 'card' : 'page']!;
        const image = await sharp({ create: { width, height, channels: 3, background: '#000' } }).jpeg().toBuffer();
        return new Response(new Uint8Array(image), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    const neutral = { brightness: 1, contrast: 1 };
    const face = (source: Face['source'], adjustments = neutral): Face => ({ file: 'x.jpg', base: 'base-x.jpg', source, adjustments });

    assert.equal(await linkedImage(face({ type: 'mpcfill', id: 'page' }), 2220), 'https://lh3.googleusercontent.com/d/page=h2220-l100');
    assert.equal(await linkedImage(face({ type: 'cardback', driveId: 'page' }), 1110), 'https://lh3.googleusercontent.com/d/page=h1110-l100');
    assert.equal(await linkedImage(face({ type: 'mpcfill', id: 'card' }), 2220), undefined, 'without bleed it needs the processed image');
    assert.equal(await linkedImage(face({ type: 'mpcfill', id: 'page' }, { brightness: 1.1, contrast: 1 }), 2220), undefined, 'adjustments only exist in the processed image');
    assert.equal(await linkedImage(face({ type: 'custom', image: 'own.png' }), 2220), undefined);
});
