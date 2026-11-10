import fs from 'node:fs/promises';
import { DefaultProfile, type ProcessingProfile } from "../model.js";
import { dataPath } from "./paths.js";
import { readJsonFiles, writeJsonFile } from "./jsonStore.js";
import { renameWithRetry } from "../utils/fs.js";

function profileFile(name: string) {
    return dataPath('config', 'profiles', `${name}.json`);
}

export async function loadProcessingProfiles(onUnreadable?: (file: string) => void): Promise<ProcessingProfile[]> {
    const configs = (await readJsonFiles(dataPath('config', 'profiles'), onUnreadable)).map(config => ({ ...DefaultProfile, ...config as Partial<ProcessingProfile> }));
    return configs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveProcessingProfile(config: ProcessingProfile): Promise<void> {
    await writeJsonFile(profileFile(config.name), config);
}

// Written under the old name and then renamed: saving under a name that only differs in case and deleting the old file would delete both on macOS and Windows.
export async function renameProcessingProfile(from: string, config: ProcessingProfile): Promise<void> {
    await writeJsonFile(profileFile(from), config);
    await renameWithRetry(profileFile(from), profileFile(config.name));
}

export async function deleteProcessingProfile(config: ProcessingProfile): Promise<void> {
    await fs.unlink(profileFile(config.name));
}
