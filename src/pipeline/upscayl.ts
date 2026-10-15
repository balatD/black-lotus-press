import fs from "node:fs/promises";
import path from "node:path";
import { exists, grantExecutionPermission, renameWithRetry } from "../utils/fs.js";
import type { PostProcessingProfile, UpscaylSettings } from "../model.js";
import { execFile } from "node:child_process";
import sharp from 'sharp';
import { downloadGitHubDirectory, downloadLatestRelease } from "./githubDownloader.js";
import { resolveDataPath } from "../config/paths.js";
import Bottleneck from "bottleneck";

// The upscaler already uses the whole GPU, so images are upscaled one at a time.
const upscaylBottleneck = new Bottleneck({ maxConcurrent: 1 });

export async function upscaleImage(filePath: string, postProcessing: PostProcessingProfile, upscaling: UpscaylSettings, signal?: AbortSignal) {
    if (!upscaling.enabled) return;

    const upscaylBinary = resolveDataPath(upscaling.binaryFile!);

    const temporaryPath = filePath.replace('.png', '-temp.png');

    const imageMetadata = await sharp(filePath).metadata();
    const width = imageMetadata.width;
    const targetWidth = Math.round(postProcessing.cardWidth * postProcessing.dpi);

    let scale = Math.ceil(targetWidth / width);
    if (scale <= 1) return;
    if (scale > 4) scale = 4;

    const args = ['-i', filePath, '-o', temporaryPath, '-n', upscaling.model, '-s', String(scale)];
    if (upscaling.modelsDirectory) args.push('-m', resolveDataPath(upscaling.modelsDirectory));

    await upscaylBottleneck.schedule(() => new Promise((resolve, reject) => {
        execFile(upscaylBinary, args, signal ? { signal } : {}, (err) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(undefined);
        })
    }));

    await renameWithRetry(temporaryPath, filePath);
}

export async function downloadUpscaylBinary(binaryFile: string) {
    const targetPath = resolveDataPath(binaryFile);
    if (await exists(targetPath)) return;

    const targetDir = path.dirname(targetPath);
    if (!await exists(targetDir)) {
        await fs.mkdir(targetDir, { recursive: true });
    }

    // Next to the target, because renaming across volumes fails.
    const tempDir = await fs.mkdtemp(path.join(targetDir, 'upscayl-'));
    await downloadLatestRelease('upscayl', 'upscayl-ncnn', tempDir);

    const contents = await fs.readdir(tempDir);

    const upscaylDirectory = contents[0]!;
    const binaryName = process.platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
    const binaryPath = path.join(tempDir, upscaylDirectory, binaryName);

    await fs.rename(binaryPath, targetPath);
    await grantExecutionPermission(targetPath);

    await fs.rm(tempDir, { recursive: true, force: true });
}

export async function downloadUpscaylModels(modelsDirectory: string) {
    const targetPath = resolveDataPath(modelsDirectory);
    if (!await exists(targetPath)) {
        await fs.mkdir(targetPath, { recursive: true });
    }

    await downloadGitHubDirectory('upscayl', 'upscayl', 'resources/models', targetPath);
}

export async function getUpscaylModels(modelsDirectory: string) {
    const files = await fs.readdir(resolveDataPath(modelsDirectory));
    const models = files.filter(file => file.endsWith('.param')).map(file => file.replace('.param', ''));
    models.sort();
    return models;
}
