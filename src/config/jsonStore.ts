import fs from "node:fs/promises";
import path from "node:path";
import { exists, renameWithRetry } from "../utils/fs.js";

export async function readJsonFiles(dir: string): Promise<unknown[]> {
    if (!await exists(dir)) return [];

    const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json'));
    return await Promise.all(files.map(async file => JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8'))));
}

export async function writeJsonFile(filePath: string, value: unknown) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Written next to the target and renamed, so a crash never leaves a truncated file behind.
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
    await renameWithRetry(tmpPath, filePath);
}
