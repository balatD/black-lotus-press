import fs from 'node:fs/promises';
import { DefaultProfile, type ProcessingProfile } from "../model.js";
import { dataPath } from "./paths.js";
import { readJsonFiles, writeJsonFile } from "./jsonStore.js";

function profileFile(name: string) {
    return dataPath('config', 'profiles', `${name}.json`);
}

export async function loadProcessingProfiles(): Promise<ProcessingProfile[]> {
    const configs = (await readJsonFiles(dataPath('config', 'profiles'))).map(config => ({ ...DefaultProfile, ...config as Partial<ProcessingProfile> }));
    return configs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveProcessingProfile(config: ProcessingProfile): Promise<void> {
    await writeJsonFile(profileFile(config.name), config);
}

export async function deleteProcessingProfile(config: ProcessingProfile): Promise<void> {
    await fs.unlink(profileFile(config.name));
}
