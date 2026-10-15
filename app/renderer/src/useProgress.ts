import { useEffect, useState } from "react";
import { api } from "./api.js";

export interface Progress {
    done: number;
    total: number;
    message: string;
}

// Progress of the job in the main process while `active`, so a finished job's last step never shows up for the next one.
export function useProgress(active: boolean) {
    const [progress, setProgress] = useState<Progress>();

    useEffect(() => {
        if (!active) return;
        const stop = api.onProgress(event => {
            if (event.type === 'progress') setProgress({ done: event.done, total: event.total, message: event.message });
        });
        return () => {
            stop();
            setProgress(undefined);
        };
    }, [active]);

    return progress;
}
