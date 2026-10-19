import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cacheDriveImage, downloadDriveImage } from "./googleDrive.js";

afterEach(() => mock.restoreAll());

test('downloadDriveImage returns the image bytes of a public file', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));

    const image = await downloadDriveImage('1LrVX0pUcye9n_0RtaDNVl2xPrQgn7CYf');

    assert.deepEqual([...image], [0xff, 0xd8, 0xff]);
    assert.equal(fetchMock.mock.calls[0]!.arguments[0], 'https://drive.google.com/uc?export=download&id=1LrVX0pUcye9n_0RtaDNVl2xPrQgn7CYf');
});

test('downloadDriveImage rejects HTML responses', async () => {
    mock.method(globalThis, 'fetch', async () =>
        new Response('<html></html>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }));

    await assert.rejects(downloadDriveImage('unknown'), /Google Drive image unknown could not be downloaded \(404/);
});

test('cacheDriveImage downloads an image once, also when asked for it several times at once', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'drive-cache-')), 'cache', 'drive1-h2220.jpg');

    await Promise.all([cacheDriveImage('drive1', 2220, file), cacheDriveImage('drive1', 2220, file)]);
    await cacheDriveImage('drive1', 2220, file);

    assert.deepEqual([...await fs.readFile(file)], [0xff, 0xd8, 0xff]);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(fetchMock.mock.calls[0]!.arguments[0], 'https://lh3.googleusercontent.com/d/drive1=h2220-l100');
});

test('cacheDriveImage leaves no file when the download fails, so the next call tries again', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
        new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-cache-'));
    const file = path.join(folder, 'private-h2220.jpg');

    await assert.rejects(cacheDriveImage('private', 2220, file), /could not be downloaded/);
    await assert.rejects(cacheDriveImage('private', 2220, file), /could not be downloaded/);

    assert.deepEqual(await fs.readdir(folder), []);
    assert.equal(fetchMock.mock.callCount(), 2);
});
