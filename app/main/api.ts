import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { app, type BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";
import type { Browser, BrowserContext } from "playwright";
import { copyOrder, deleteOrder, loadOrders, moveOrder, renameOrder, saveOrder } from "../../src/config/orderConfigManager.js";
import { deleteProcessingProfile, loadProcessingProfiles, saveProcessingProfile } from "../../src/config/processingProfileManager.js";
import { orderDir } from "../../src/config/paths.js";
import { downloadDriveImage } from "../../src/clients/googleDrive.js";
import { mpcfillFileNames, searchCardbacks } from "../../src/clients/mpcfill.js";
import { downloadUpscaylBinary, downloadUpscaylModels, getUpscaylModels } from "../../src/pipeline/upscayl.js";
import { DefaultProfile, type OnProgress } from "../../src/model.js";
import { importDeck } from "../../src/pipeline/importDecks.js";
import { searchPrintings, searchTokens } from "../../src/clients/scryfall.js";
import { findMpcfillImages, loadPrintingScans, pickSharpestMpcfillImages, recogniseMpcfillImages } from "../../src/mpcfill/recognise.js";
import { MANUAL_UPLOAD_URL, uploadToMeinspiel } from "../../src/clients/meinspiel.js";
import { sendToNotmpc } from "../../src/clients/notmpc.js";
import { sendToPrinterstudio } from "../../src/clients/printerstudio.js";
import { showShopWindow } from "../../src/clients/shopWindow.js";
import { forgetImages, imageStatus, processImages } from "../../src/pipeline/processImages.js";
import { buildPdfs } from "../../src/output/meinspielPdf.js";
import { mpcfillImages, mpcfillXml } from "../../src/output/mpcfillXml.js";
import { exists } from "../../src/utils/fs.js";
import { ensureIccProfile } from "../../src/output/iccProfile.js";
import { importCustomImage } from "../../src/pipeline/customImage.js";
import { gpuStatsReader } from "../../src/utils/gpuStats.js";
import { API_METHODS, type Api, type Task } from "../shared/api.js";
import { installUpdate, updateStatus } from "./updater.js";

export function registerApi(window: BrowserWindow) {
    let nextTaskId = 1;
    let job: { task: Task, controller: AbortController } | undefined;
    let upload: { task: Task, browser: Browser | BrowserContext } | undefined;

    const gpuTemperature = app.isPackaged
        ? path.join(process.resourcesPath, 'native', 'gpu-temperature')
        : path.join(import.meta.dirname, '../../build/native/gpu-temperature');
    const gpuStats = gpuStatsReader(process.platform === 'darwin' ? gpuTemperature : undefined);

    const listTasks = () => [job?.task, upload?.task].filter(task => task !== undefined);

    // Kept, because a notification that is collected as garbage no longer reports its click.
    let notification: Notification | undefined;
    function notify(title: string, body: string) {
        if (window.isDestroyed() || window.isFocused() || !Notification.isSupported()) return;
        notification = new Notification({ title, body });
        notification.on('click', () => {
            if (window.isMinimized()) window.restore();
            window.focus();
        });
        notification.show();
    }


    function publishTasks() {
        if (!window.isDestroyed()) window.webContents.send('tasks', listTasks());
    }

    async function closeUploadBrowser() {
        const browser = upload?.browser;
        upload = undefined;
        publishTasks();
        await browser?.close();
    }

    // The browser stays open so the user can order there; closing it by hand ends the task as well.
    function keepBrowser(browser: Browser | BrowserContext, title: string, order: string) {
        upload = { task: { id: nextTaskId++, kind: 'browser', title, order, stoppable: true }, browser };
        const closed = () => {
            if (upload?.browser !== browser) return;
            upload = undefined;
            publishTasks();
        };
        if ('contexts' in browser) browser.on('disconnected', closed); else browser.on('close', closed);
    }

    window.on('closed', () => void closeUploadBrowser());

    async function runJob<T>(task: Omit<Task, 'id'>, work: (onProgress: OnProgress, signal: AbortSignal) => Promise<T>): Promise<T> {
        if (job) throw new Error('Another task is still running. Wait for it or cancel it first.');
        const controller = new AbortController();
        job = { task: { ...task, id: nextTaskId++ }, controller };
        publishTasks();
        try {
            const result = await work(event => window.webContents.send('progress', event), controller.signal);
            notify(task.title, 'Done.');
            return result;
        } catch (error) {
            // Stopping a browser task closes the browser, which surfaces as some Playwright error.
            controller.signal.throwIfAborted();
            notify(task.title, error instanceof Error ? error.message : String(error));
            throw error;
        } finally {
            job = undefined;
            publishTasks();
        }
    }

    // A task of the order may be writing its images right now.
    function assertIdle(order: string) {
        if (job?.task.order === order) throw new Error(`${job.task.title} is still running. Wait for it or cancel it first.`);
    }

    const handlers: Api = {
        async listProfiles() {
            const unreadable: string[] = [];
            const profiles = await loadProcessingProfiles(file => unreadable.push(file));
            // A default profile written over one that cannot be read would destroy it.
            if (profiles.length > 0 || unreadable.length > 0) return { profiles, unreadable };

            // The packaged app has no project folder, so orders go to the documents folder.
            const profile = app.isPackaged
                ? { ...DefaultProfile, outputDirectory: path.join(app.getPath('documents'), 'Black Lotus Press', 'orders') }
                : DefaultProfile;
            await saveProcessingProfile(profile);
            return { profiles: [profile], unreadable };
        },
        saveProfile: saveProcessingProfile,
        deleteProfile: deleteProcessingProfile,
        installUpscayl: (binaryFile, modelsDirectory) => runJob({ kind: 'upscayl', title: 'Installing Upscayl', stoppable: false }, async onProgress => {
            onProgress({ type: 'progress', done: 0, total: 0, message: 'Downloading the Upscayl program from GitHub' });
            await downloadUpscaylBinary(binaryFile);
            onProgress({ type: 'progress', done: 0, total: 0, message: 'Downloading the Upscayl models from GitHub' });
            await downloadUpscaylModels(modelsDirectory);
            return await getUpscaylModels(modelsDirectory);
        }),
        listUpscaylModels: getUpscaylModels,
        async chooseFolder() {
            const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
            return result.filePaths[0];
        },

        async listOrders() {
            const unreadable: string[] = [];
            return { orders: await loadOrders(file => unreadable.push(file)), unreadable };
        },
        saveOrder,
        deleteOrder,
        async moveOrder(order, shop) {
            assertIdle(order.name);
            await moveOrder(order, shop);
        },
        async copyOrder(order, shop, name) {
            assertIdle(order.name);
            await copyOrder(order, shop, name);
        },
        async renameOrder(order, name) {
            assertIdle(order.name);
            await renameOrder(order, name);
        },
        listCardbacks: searchCardbacks,
        async previewCardBack(driveId) {
            const preview = await sharp(await downloadDriveImage(driveId)).resize(240).jpeg({ quality: 80 }).toBuffer();
            return `data:image/jpeg;base64,${preview.toString('base64')}`;
        },
        async saveMpcfillXml(order) {
            const { fronts, backs } = mpcfillImages(order);
            const images = [...fronts, ...backs];
            let missing = 0;
            for (const image of images) {
                if (image.local && !await exists(image.id)) missing++;
            }
            if (missing > 0) throw new Error(`Process the images first: ${missing} of the images in the XML are not processed yet.`);

            const names = await mpcfillFileNames(images.filter(image => !image.local).map(image => image.id));
            const result = await dialog.showSaveDialog(window, {
                defaultPath: path.join(orderDir(order), `${order.name}.xml`),
                filters: [{ name: 'MPC Autofill order', extensions: ['xml'] }]
            });
            if (result.canceled || !result.filePath) return undefined;
            await fs.writeFile(result.filePath, mpcfillXml(order, names));
            return result.filePath;
        },
        async openOrderFolder(order) {
            const folder = orderDir(order);
            await fs.mkdir(folder, { recursive: true });
            await shell.openPath(folder);
        },

        importDeck: (deck, channel) => runJob(
            { kind: 'import', title: `Loading ${deck.name ?? 'a deck'} from Moxfield`, deck: deck.url, stoppable: true },
            (onProgress, signal) => importDeck(deck, channel, onProgress, signal)),
        processImages: order => runJob(
            { kind: 'process', title: `Processing the images of ${order.name}`, order: order.name, stoppable: true },
            async (onProgress, signal) => processImages(order, await ensureIccProfile(), onProgress, signal)),
        reprocessImages: (order, files) => runJob(
            { kind: 'process', title: `Processing images of ${order.name} again`, order: order.name, stoppable: true },
            async (onProgress, signal) => {
                await forgetImages(order, files);
                await processImages(order, await ensureIccProfile(), onProgress, signal);
            }),
        buildPdfs: order => runJob(
            { kind: 'pdfs', title: `Writing the PDFs of ${order.name}`, order: order.name, stoppable: false },
            async onProgress => buildPdfs(order, await fs.readFile(await ensureIccProfile()), onProgress)),
        uploadPacks: (orderName, packs, channel) => runJob(
            { kind: 'upload', title: `Uploading ${orderName} to meinspiel.de`, order: orderName, stoppable: true },
            async (onProgress, signal) => {
                await closeUploadBrowser();
                try {
                    const { session, games } = await uploadToMeinspiel(orderName, packs, channel, window.getBounds(), onProgress, signal);
                    if (session) keepBrowser(session.context, `meinspiel.de with the games of ${orderName}`, orderName);
                    return games;
                } catch (error) {
                    if (signal.aborted) throw error;
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`${message} You can upload the PDFs by hand at ${MANUAL_UPLOAD_URL}`);
                }
            }),
        sendToNotmpc: order => runJob(
            { kind: 'upload', title: `Sending ${order.name} to notmpc.eu`, order: order.name, stoppable: true },
            async (onProgress, signal) => {
                await closeUploadBrowser();
                keepBrowser(await sendToNotmpc(order, onProgress, signal), `notmpc.eu with the decks of ${order.name}`, order.name);
            }),
        sendToPrinterstudio: order => runJob(
            { kind: 'upload', title: `Sending ${order.name} to printerstudio.de`, order: order.name, stoppable: true },
            async (onProgress, signal) => {
                await closeUploadBrowser();
                const { context, unsaved } = await sendToPrinterstudio(order, window.getBounds(), onProgress, signal);
                keepBrowser(context, `printerstudio.de with the decks of ${order.name}`, order.name);
                if (unsaved.length > 0) {
                    throw new Error(`printerstudio.de did not confirm saving deck ${unsaved.join(', ')} in your account. Save it in its tab with "Speichern".`);
                }
            }),
        pickMpcfillImages: order => runJob(
            { kind: 'mpcfill', title: `Looking for MPC Autofill images for ${order.name}`, order: order.name, stoppable: true },
            (onProgress, signal) => pickSharpestMpcfillImages(order.cards, onProgress, signal)),
        imageStatus,
        gpuStats,
        async listTasks() {
            return listTasks();
        },
        showShopBrowser: showShopWindow,
        async stopTask(id) {
            if (job?.task.id === id) job.controller.abort();
            if (upload?.task.id === id) await closeUploadBrowser();
        },

        searchPrintings,
        searchTokens,
        searchMpcfill: findMpcfillImages,
        loadPrintingScans,
        recogniseMpcfill: recogniseMpcfillImages,
        async pickCustomImage() {
            const result = await dialog.showOpenDialog(window, {
                properties: ['openFile'],
                filters: [{ name: 'Card images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
            });
            const file = result.filePaths[0];
            return file ? await importCustomImage(file) : undefined;
        },

        async updateStatus() {
            return updateStatus();
        },
        async installUpdate() {
            installUpdate();
        }
    };

    ipcMain.handle('api', (_event, method: string, ...args: unknown[]) => {
        if (!(API_METHODS as readonly string[]).includes(method)) throw new Error(`Unknown method ${method}`);
        return (handlers[method as keyof Api] as (...params: unknown[]) => unknown)(...args);
    });
}
