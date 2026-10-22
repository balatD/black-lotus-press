import fs from "node:fs/promises";
import path from "node:path";
import { exists, renameWithRetry } from "../utils/fs.js";

// A file that cannot be read is skipped and reported, so one broken file never hides the others.
export async function readJsonFiles(dir: string, onUnreadable?: (file: string) => void): Promise<unknown[]> {
    if (!await exists(dir)) return [];

    const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json')).map(file => path.join(dir, file));
    const results = await Promise.allSettled(files.map(async file => JSON.parse(await fs.readFile(file, 'utf-8'))));
    return results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [result.value];
        onUnreadable?.(files[index]!);
        return [];
    });
}

export async function writeJsonFile(filePath: string, value: unknown) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Written next to the target and renamed, so a crash never leaves a truncated file behind.
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
    await renameWithRetry(tmpPath, filePath);
}
