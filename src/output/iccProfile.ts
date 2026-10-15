import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { exists } from "../utils/fs.js";
import { dataPath } from "../config/paths.js";

const ICC_ZIP_URL = 'https://www.meinspiel.de/wp-content/uploads/2023/01/Farbprofile-MeinSpiel-2.zip';
const ICC_ZIP_ENTRY = 'Farbprofile/ISOcoated_v2_300_eci.icc';

export async function ensureIccProfile(): Promise<string> {
    const iccPath = dataPath('config', 'icc', 'ISOcoated_v2_300_eci.icc');
    if (await exists(iccPath)) return iccPath;

    const response = await fetch(ICC_ZIP_URL);
    if (!response.ok) {
        throw new Error(`Failed to download the meinspiel colour profile: ${response.status} ${response.statusText}`);
    }

    const entry = new AdmZip(Buffer.from(await response.arrayBuffer())).getEntry(ICC_ZIP_ENTRY);
    if (!entry) {
        throw new Error(`${ICC_ZIP_ENTRY} not found in ${ICC_ZIP_URL}`);
    }

    await fs.mkdir(path.dirname(iccPath), { recursive: true });
    await fs.writeFile(iccPath, entry.getData());
    return iccPath;
}
