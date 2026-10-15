import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { dataPath, resolveDataPath, setDataRoot } from "./paths.js";

afterEach(() => setDataRoot(process.cwd()));

test('dataPath and resolveDataPath follow the data root', () => {
    const root = path.resolve('/tmp/proxy-forge-root');
    setDataRoot(root);

    assert.equal(dataPath('config', 'orders'), path.join(root, 'config', 'orders'));
    assert.equal(resolveDataPath('./orders'), path.join(root, 'orders'));
});

test('resolveDataPath keeps absolute paths', () => {
    setDataRoot(path.resolve('/tmp/proxy-forge-root'));
    const absolute = path.resolve('/somewhere/else/orders');

    assert.equal(resolveDataPath(absolute), absolute);
});
