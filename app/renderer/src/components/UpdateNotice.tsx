import { useEffect, useState } from "react";
import { CircleArrowDown, Download, RotateCw } from "lucide-react";
import type { Update } from "../../../shared/api.js";
import { api } from "../api.js";
import { useTasks } from "../useTasks.js";

// The website offers the download for this system, and on a Mac the step that opens the unsigned app.
const DOWNLOAD_URL = 'https://balatd.github.io/black-lotus-press/';

export function UpdateNotice() {
    const [update, setUpdate] = useState<Update>();
    const tasks = useTasks();

    useEffect(() => {
        let updated = false;
        const stop = api.onUpdate(current => {
            updated = true;
            setUpdate(current);
        });
        void api.updateStatus().then(current => updated || setUpdate(current));
        return stop;
    }, []);

    if (!update) return null;

    return (
        <section className="task update" aria-label="Update">
            <span className="with-icon"><CircleArrowDown/>Update to {update.version}</span>
            {update.state === 'available' && (
                <button className="quiet" onClick={() => window.open(DOWNLOAD_URL)}><Download/>Download</button>
            )}
            {update.state === 'downloading' && <span className="status">Downloading…</span>}
            {update.state === 'ready' && (
                <>
                    <span className="status">{tasks.length > 0 ? 'Installs when the running task is done and you restart or quit.' : 'Installs when you restart or quit.'}</span>
                    <button className="primary" disabled={tasks.length > 0} onClick={() => void api.installUpdate()}><RotateCw/>Restart now</button>
                </>
            )}
        </section>
    );
}
