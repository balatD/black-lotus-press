import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ProgressEvent } from "../../src/model.js";
import { API_METHODS, type Api, type Bridge, type Task, type Update } from "../shared/api.js";

const methods = Object.fromEntries(API_METHODS.map(method => [method, (...args: unknown[]) => ipcRenderer.invoke('api', method, ...args)])) as unknown as Api;

const bridge: Bridge = {
    ...methods,
    onProgress(listener: (event: ProgressEvent) => void) {
        const handler = (_event: IpcRendererEvent, progress: ProgressEvent) => listener(progress);
        ipcRenderer.on('progress', handler);
        return () => {
            ipcRenderer.removeListener('progress', handler);
        };
    },
    onTasks(listener: (tasks: Task[]) => void) {
        const handler = (_event: IpcRendererEvent, tasks: Task[]) => listener(tasks);
        ipcRenderer.on('tasks', handler);
        return () => {
            ipcRenderer.removeListener('tasks', handler);
        };
    },
    onUpdate(listener: (update: Update) => void) {
        const handler = (_event: IpcRendererEvent, update: Update) => listener(update);
        ipcRenderer.on('update', handler);
        return () => {
            ipcRenderer.removeListener('update', handler);
        };
    }
};

contextBridge.exposeInMainWorld('api', bridge);
