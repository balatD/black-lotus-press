import type { DeckConfig, GpuStats, MpcfillImage, Order, OrderCard, PackFiles, PlaywrightChannel, ProcessingProfile, ProgressEvent, ScryfallCard, Shop, UploadedGame } from "../../src/model.js";
import type { DroppedToken } from "../../src/pipeline/packs.js";
import type { MpcfillCard } from "../../src/clients/mpcfill.js";
import type { Recognition } from "../../src/mpcfill/recognise.js";

// A job of the main process, or the shop's browser that stays open after an upload.
export interface Task {
    id: number;
    kind: 'import' | 'process' | 'pdfs' | 'upload' | 'upscayl' | 'mpcfill' | 'browser';
    title: string;
    order?: string;
    deck?: string;
    stoppable: boolean;
}

// A newer release: to download from the website, being downloaded, or downloaded and installed on quit or restart.
export interface Update {
    version: string;
    state: 'available' | 'downloading' | 'ready';
}

// Everything the window can ask the main process to do.
export interface Api {
    // Files that cannot be read are left out and named.
    listProfiles(): Promise<{ profiles: ProcessingProfile[], unreadable: string[] }>;
    saveProfile(profile: ProcessingProfile): Promise<void>;
    deleteProfile(profile: ProcessingProfile): Promise<void>;
    installUpscayl(binaryFile: string, modelsDirectory: string): Promise<string[]>;
    listUpscaylModels(modelsDirectory: string): Promise<string[]>;
    chooseFolder(): Promise<string | undefined>;

    listOrders(): Promise<{ orders: Order[], unreadable: string[] }>;
    saveOrder(order: Order): Promise<void>;
    deleteOrder(order: Order): Promise<void>;
    // The order keeps its name; its print images are made anew in the other shop's format.
    moveOrder(order: Order, shop: Shop): Promise<void>;
    // A copy under a new name, with the processed downloads, so nothing is upscaled again.
    copyOrder(order: Order, shop: Shop, name: string): Promise<void>;
    // With its images, PDFs and the games of the last upload.
    renameOrder(order: Order, name: string): Promise<void>;
    // Every card back of MPC Autofill, in its order.
    listCardbacks(): Promise<MpcfillCard[]>;
    previewCardBack(driveId: string): Promise<string>;
    // Asks where to save the order file; the path, or undefined when the dialog was cancelled.
    saveMpcfillXml(order: Order): Promise<string | undefined>;
    openOrderFolder(order: Order): Promise<void>;

    // Long-running jobs report through onProgress and show up in the tasks; only one runs at a time.
    importDeck(deck: DeckConfig, channel: PlaywrightChannel): Promise<{ name: string, cards: OrderCard[] }>;
    processImages(order: Order): Promise<void>;
    // Makes these faces anew from the download on, then processes what is missing.
    reprocessImages(order: Order, files: string[]): Promise<void>;
    buildPdfs(order: Order): Promise<{ packs: PackFiles[], droppedTokens: DroppedToken[] }>;
    // The browser stays open after the upload so the user can order; it stays a task until closed.
    uploadPacks(orderName: string, packs: PackFiles[], channel: PlaywrightChannel): Promise<UploadedGame[]>;
    // Uploads the print images and fills a notmpc.eu designer per deck; the browser stays open like after uploadPacks.
    sendToNotmpc(order: Order): Promise<void>;
    // Fills a printerstudio.de designer per deck up to its preview; the browser stays open like after uploadPacks.
    sendToPrinterstudio(order: Order): Promise<void>;
    // The sharpest MPC Autofill images that show the printings, by card id, for the cards without an own or MPC Autofill image.
    pickMpcfillImages(order: Order): Promise<Record<string, MpcfillImage>>;
    listTasks(): Promise<Task[]>;
    // Brings the window of meinspiel.de or printerstudio.de to the front, while it is open.
    showShopBrowser(): Promise<void>;
    // Stopping a browser task closes its browser.
    stopTask(id: number): Promise<void>;

    imageStatus(order: Order): Promise<{ version: string, files: Record<string, number> }>;
    gpuStats(): Promise<GpuStats>;

    searchPrintings(card: Pick<OrderCard, 'name' | 'printing'>): Promise<ScryfallCard[]>;
    searchTokens(name: string): Promise<ScryfallCard[]>;
    // The MPC Autofill images of a face of the card, in MPC Autofill's order.
    searchMpcfill(card: Pick<OrderCard, 'name' | 'printing' | 'isToken'>, face: 'front' | 'back'): Promise<MpcfillCard[]>;
    // Loads the Scryfall scans the comparison needs; the window asks for a few at a time to show the progress.
    loadPrintingScans(face: 'front' | 'back', printings: ScryfallCard[]): Promise<void>;
    // Which of the printings each image shows; slow the first time, so the window asks for a few images at a time.
    recogniseMpcfill(face: 'front' | 'back', printings: ScryfallCard[], images: MpcfillCard[]): Promise<Record<string, Recognition>>;
    // Returns the stored file name, or undefined when the dialog was cancelled.
    pickCustomImage(): Promise<string | undefined>;

    // The newer release found since the start, if any; changes arrive through onUpdate.
    updateStatus(): Promise<Update | undefined>;
    // Quits, installs the downloaded update and starts the new version.
    installUpdate(): Promise<void>;
}

export const API_METHODS = [
    'listProfiles', 'saveProfile', 'deleteProfile', 'installUpscayl', 'listUpscaylModels', 'chooseFolder',
    'listOrders', 'saveOrder', 'deleteOrder', 'moveOrder', 'copyOrder', 'renameOrder', 'listCardbacks', 'previewCardBack', 'saveMpcfillXml', 'openOrderFolder',
    'importDeck', 'processImages', 'reprocessImages', 'buildPdfs', 'uploadPacks', 'sendToNotmpc', 'sendToPrinterstudio', 'pickMpcfillImages', 'listTasks', 'showShopBrowser', 'stopTask',
    'imageStatus', 'gpuStats', 'searchPrintings', 'searchTokens', 'searchMpcfill', 'loadPrintingScans', 'recogniseMpcfill', 'pickCustomImage', 'updateStatus', 'installUpdate'
] as const satisfies readonly (keyof Api)[];

// Fails to compile when a method of Api is missing from API_METHODS.
export const allMethodsListed: Exclude<keyof Api, (typeof API_METHODS)[number]> extends never ? true : false = true;

export type Bridge = Api & {
    onProgress(listener: (event: ProgressEvent) => void): () => void;
    onTasks(listener: (tasks: Task[]) => void): () => void;
    onUpdate(listener: (update: Update) => void): () => void;
};
