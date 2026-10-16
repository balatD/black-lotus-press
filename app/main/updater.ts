import fs from "node:fs";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { Update } from "../shared/api.js";

const { autoUpdater } = electronUpdater;

let update: Update | undefined;

// Squirrel.Mac only installs updates of apps signed with an Apple certificate, and a portable ZIP of the
// Windows app has no installer to run, so those only learn about the new version.
function installsItself() {
    if (process.platform === 'win32') return fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Black Lotus Press.exe'));
    return process.platform === 'linux' && process.env.APPIMAGE !== undefined;
}

// Looks for a newer release on GitHub once per start; where it can, downloads it to install on quit or restart.
export function checkForUpdates(window: BrowserWindow) {
    if (!app.isPackaged) return;
    const installs = installsItself();
    autoUpdater.autoDownload = installs;

    const publish = (next: Update) => {
        update = next;
        if (!window.isDestroyed()) window.webContents.send('update', next);
    };
    autoUpdater.on('update-available', info => publish({ version: info.version, state: installs ? 'downloading' : 'available' }));
    autoUpdater.on('update-downloaded', info => publish({ version: info.version, state: 'ready' }));
    // Offline, or GitHub did not answer: the app works on and checks again at the next start.
    autoUpdater.on('error', error => console.warn('Checking for updates failed:', error.message));
    autoUpdater.checkForUpdates().catch(() => {});
}

export const updateStatus = () => update;

export function installUpdate() {
    autoUpdater.quitAndInstall(true, true);
}
