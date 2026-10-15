import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { downloadDriveImage } from "./googleDrive.js";

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
