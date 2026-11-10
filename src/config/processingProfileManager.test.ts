import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProcessingProfiles, renameProcessingProfile, saveProcessingProfile } from "./processingProfileManager.js";
import { DefaultProfile } from "../model.js";
import { setDataRoot } from "./paths.js";

afterEach(() => setDataRoot(process.cwd()));

test('a renamed profile keeps its settings under the new name, also when only the case of the name changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-forge-'));
    setDataRoot(root);
    await saveProcessingProfile({ ...DefaultProfile, name: 'sharp' });

    const crisp = { ...DefaultProfile, name: 'crisp', postProcessing: { ...DefaultProfile.postProcessing, dpi: 600 } };
    await renameProcessingProfile('sharp', crisp);
    assert.deepEqual((await loadProcessingProfiles()).map(profile => [profile.name, profile.postProcessing.dpi]), [['crisp', 600]]);

    await renameProcessingProfile('crisp', { ...crisp, name: 'Crisp' });
    assert.deepEqual(await fs.readdir(path.join(root, 'config', 'profiles')), ['Crisp.json']);
    assert.deepEqual((await loadProcessingProfiles()).map(profile => profile.name), ['Crisp']);
});
