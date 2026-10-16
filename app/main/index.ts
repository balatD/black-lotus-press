import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { setDataRoot } from "../../src/config/paths.js";
import { registerApi } from "./api.js";
import { handlePreviews, registerPreviewScheme } from "./preview.js";
import { checkForUpdates } from "./updater.js";

// Started from the project folder during development, so the CLI's profiles and orders show up.
setDataRoot(app.isPackaged ? path.join(app.getPath('userData'), 'data') : process.cwd());
registerPreviewScheme();

function createWindow() {
    const window = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 640,
        title: 'Black Lotus Press',
        backgroundColor: '#1b1b1b',
        webPreferences: {
            preload: path.join(import.meta.dirname, '../preload/index.cjs'),
            contextIsolation: true,
            sandbox: true
        }
    });

    // Links open in the system browser, the window itself never navigates away from the app.
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) void shell.openExternal(url);
        return { action: 'deny' };
    });
    window.webContents.on('will-navigate', event => event.preventDefault());

    registerApi(window);
    checkForUpdates(window);

    if (process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        void window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
    }
}

// Instead of Electron's default menu: on macOS only quitting and the edit menu, which the copy and paste shortcuts need.
function createMenu() {
    if (process.platform !== 'darwin') return null;
    const name = 'Black Lotus Press';
    return Menu.buildFromTemplate([
        { label: name, submenu: [{ role: 'hide', label: `Hide ${name}` }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: `Quit ${name}` }] },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
    ]);
}

void app.whenReady().then(() => {
    Menu.setApplicationMenu(createMenu());
    // The packaged app takes the icon from its bundle; during development the Dock would show Electron's.
    if (!app.isPackaged) app.dock?.setIcon(path.join(import.meta.dirname, '../../build/icon.png'));
    handlePreviews();
    createWindow();
});

app.on('window-all-closed', () => app.quit());
