import type { DeckConfig, GpuStats, Order, OrderCard, PackFiles, PlaywrightChannel, ProcessingProfile, ProgressEvent, ScryfallCard, UploadedGame } from "../../src/model.js";
import type { DroppedToken } from "../../src/pipeline/packs.js";

// A job of the main process, or the meinspiel.de browser that stays open after an upload.
export interface Task {
    id: number;
    kind: 'import' | 'process' | 'pdfs' | 'upload' | 'upscayl' | 'browser';
    title: string;
    order?: string;
    deck?: string;
    stoppable: boolean;
}

// Everything the window can ask the main process to do.
export interface Api {
    listProfiles(): Promise<ProcessingProfile[]>;
    saveProfile(profile: ProcessingProfile): Promise<void>;
    deleteProfile(profile: ProcessingProfile): Promise<void>;
    installUpscayl(binaryFile: string, modelsDirectory: string): Promise<string[]>;
    listUpscaylModels(modelsDirectory: string): Promise<string[]>;
    chooseFolder(): Promise<string | undefined>;

    listOrders(): Promise<Order[]>;
    saveOrder(order: Order): Promise<void>;
    deleteOrder(order: Order): Promise<void>;
    previewCardBack(driveId: string): Promise<string>;
    openOrderFolder(order: Order): Promise<void>;

    // Long-running jobs report through onProgress and show up in the tasks; only one runs at a time.
    importDeck(deck: DeckConfig, channel: PlaywrightChannel): Promise<{ name: string, cards: OrderCard[] }>;
    processImages(order: Order): Promise<void>;
    // Makes these faces anew from the download on, then processes what is missing.
    reprocessImages(order: Order, files: string[]): Promise<void>;
    buildPdfs(order: Order): Promise<{ packs: PackFiles[], droppedTokens: DroppedToken[] }>;
    // The browser stays open after the upload so the user can order; it stays a task until closed.
    uploadPacks(orderName: string, packs: PackFiles[], channel: PlaywrightChannel): Promise<UploadedGame[]>;
    listTasks(): Promise<Task[]>;
    // Stopping a browser task closes its browser.
    stopTask(id: number): Promise<void>;

    imageStatus(order: Order): Promise<{ version: string, files: Record<string, number> }>;
    gpuStats(): Promise<GpuStats>;

    searchPrintings(card: Pick<OrderCard, 'name' | 'printing'>): Promise<ScryfallCard[]>;
    // Returns the stored file name, or undefined when the dialog was cancelled.
    pickCustomImage(): Promise<string | undefined>;
}

export const API_METHODS = [
    'listProfiles', 'saveProfile', 'deleteProfile', 'installUpscayl', 'listUpscaylModels', 'chooseFolder',
    'listOrders', 'saveOrder', 'deleteOrder', 'previewCardBack', 'openOrderFolder',
    'importDeck', 'processImages', 'reprocessImages', 'buildPdfs', 'uploadPacks', 'listTasks', 'stopTask',
    'imageStatus', 'gpuStats', 'searchPrintings', 'pickCustomImage'
] as const satisfies readonly (keyof Api)[];

// Fails to compile when a method of Api is missing from API_METHODS.
export const allMethodsListed: Exclude<keyof Api, (typeof API_METHODS)[number]> extends never ? true : false = true;

export type Bridge = Api & {
    onProgress(listener: (event: ProgressEvent) => void): () => void;
    onTasks(listener: (tasks: Task[]) => void): () => void;
};
