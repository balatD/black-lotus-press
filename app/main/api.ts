import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";
import type { Browser, BrowserContext } from "playwright";
import { copyOrder, deleteOrder, exportOrder, importOrder, loadOrders, moveOrder, renameOrder, saveOrder } from "../../src/config/orderConfigManager.js";
import { deleteProcessingProfile, loadProcessingProfiles, renameProcessingProfile, saveProcessingProfile } from "../../src/config/processingProfileManager.js";
import { orderDir } from "../../src/config/paths.js";
import { downloadDriveImage } from "../../src/clients/googleDrive.js";
import { mpcfillFileNames, searchCardbacks } from "../../src/clients/mpcfill.js";
import { downloadUpscaylBinary, downloadUpscaylModels, getUpscaylModels } from "../../src/pipeline/upscayl.js";
import { DEFAULT_HOME_PRINT, deckSite, DefaultProfile, type OnProgress } from "../../src/model.js";
import { importDeck } from "../../src/pipeline/importDecks.js";
import { importDeckList, searchTcgCards } from "../../src/pipeline/deckLists.js";
import { searchCards, searchPrintings, searchTokens } from "../../src/clients/scryfall.js";
import { findMpcfillImages, loadPrintingScans, pickSharpestMpcfillImages, recogniseMpcfillImages } from "../../src/mpcfill/recognise.js";
import { uploadToMeinspiel } from "../../src/clients/meinspiel.js";
import { sendToPrinterstudio } from "../../src/clients/printerstudio.js";
import { showShopWindow } from "../../src/clients/shopWindow.js";
import { forgetImages, imageStatus, processImages } from "../../src/pipeline/processImages.js";
import { mpcfillImages, mpcfillXml } from "../../src/output/mpcfillXml.js";
import { homePrintHtml, writeHomePdf } from "../../src/output/homePrint.js";
import { exists } from "../../src/utils/fs.js";
import { importCustomImage } from "../../src/pipeline/customImage.js";
import { gpuStatsReader } from "../../src/utils/gpuStats.js";
import { API_METHODS, type Api, type Task } from "../shared/api.js";
import { installUpdate, updateStatus } from "./updater.js";

const ORDER_FILES = { name: 'Black Lotus Press order', extensions: ['zip'] };

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

    // The outcome is what the notification says when the job returns.
    async function runJob<T>(task: Omit<Task, 'id'>, work: (onProgress: OnProgress, signal: AbortSignal) => Promise<T>,
                             outcome: (result: T) => string = () => 'Done.'): Promise<T> {
        if (job) throw new Error('Another task is still running. Wait for it or cancel it first.');
        const controller = new AbortController();
        job = { task: { ...task, id: nextTaskId++ }, controller };
        publishTasks();
        try {
            const result = await work(event => window.webContents.send('progress', event), controller.signal);
            // A cancelled job may still return what it did until then.
            if (!controller.signal.aborted) notify(task.title, outcome(result));
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
        async renameProfile(from, profile) {
            await renameProcessingProfile(from, profile);
            for (const order of await loadOrders()) {
                if (order.profile.name === from) await saveOrder({ ...order, profile: { ...order.profile, name: profile.name } });
            }
        },
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
        async saveHomePdf(order) {
            assertIdle(order.name);
            const result = await dialog.showSaveDialog(window, {
                defaultPath: path.join(orderDir(order), `${order.name}.pdf`),
                filters: [{ name: 'PDF', extensions: ['pdf'] }]
            });
            if (result.canceled || !result.filePath) return undefined;
            await writeHomePdf(order, result.filePath);
            await shell.openPath(result.filePath);
            return result.filePath;
        },
        // Electron cannot print a PDF file, so a hidden window prints the same pages as a web page.
        async printHome(order) {
            assertIdle(order.name);
            const settings = order.homePrint ?? DEFAULT_HOME_PRINT;
            const file = path.join(app.getPath('temp'), `black-lotus-press-${process.pid}.html`);
            await fs.writeFile(file, await homePrintHtml(order));
            const printWindow = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
            try {
                await printWindow.loadFile(file);
                return await new Promise<boolean>((resolve, reject) => printWindow.webContents.print({
                    margins: { marginType: 'none' }, pageSize: settings.paper === 'a4' ? 'A4' : 'Letter', landscape: settings.landscape
                }, (success, failureReason) => {
                    if (success || failureReason === 'cancelled') resolve(success);
                    else reject(new Error(`Printing failed: ${failureReason}`));
                }));
            } finally {
                printWindow.destroy();
                await fs.rm(file, { force: true });
            }
        },
        async exportOrder(order, withImages) {
            assertIdle(order.name);
            const result = await dialog.showSaveDialog(window, {
                defaultPath: path.join(app.getPath('downloads'), `${order.name}.zip`),
                filters: [ORDER_FILES]
            });
            if (result.canceled || !result.filePath) return undefined;
            await exportOrder(order, result.filePath, withImages);
            return result.filePath;
        },
        async importOrder() {
            const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [ORDER_FILES] });
            const file = result.filePaths[0];
            return file ? await importOrder(file, await loadProcessingProfiles()) : undefined;
        },
        async openOrderFolder(order) {
            const folder = orderDir(order);
            await fs.mkdir(folder, { recursive: true });
            await shell.openPath(folder);
        },

        importDeck: (deck, channel) => runJob(
            { kind: 'import', title: `Loading ${deck.name ?? 'a deck'} from ${deckSite(deck.url)}`, deck: deck.url, stoppable: true },
            (onProgress, signal) => importDeck(deck, channel, onProgress, signal)),
        importDeckList: (deck, tcg, language) => runJob(
            { kind: 'import', title: `Looking up ${deck.name ?? 'a deck list'} on ${tcg === 'yugioh' ? 'YGOPRODeck' : 'TCGdex'}`, deck: deck.url, stoppable: true },
            (onProgress, signal) => importDeckList(deck, tcg, language, onProgress, signal)),
        processImages: order => runJob(
            { kind: 'process', title: `Processing the images of ${order.name}`, order: order.name, stoppable: true },
            (onProgress, signal) => processImages(order, onProgress, signal)),
        reprocessImages: (order, files) => runJob(
            { kind: 'process', title: `Processing images of ${order.name} again`, order: order.name, stoppable: true },
            async (onProgress, signal) => {
                await forgetImages(order, files);
                await processImages(order, onProgress, signal);
            }),
        uploadPacks: (order, done) => runJob(
            { kind: 'upload', title: `Uploading ${order.name} to meinspiel.de`, order: order.name, stoppable: true },
            async (onProgress, signal) => {
                await closeUploadBrowser();
                const { session, games, error } = await uploadToMeinspiel(order, done, window.getBounds(), onProgress, signal);
                if (session) keepBrowser(session.context, `meinspiel.de with the games of ${order.name}`, order.name);
                // Cancelling keeps the games made until then, without an error to show.
                return error === undefined || signal.aborted ? { games } : { games, error: error instanceof Error ? error.message : String(error) };
            }, result => result.error ?? 'Done.'),
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
        searchCards,
        searchTcgCards,
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
