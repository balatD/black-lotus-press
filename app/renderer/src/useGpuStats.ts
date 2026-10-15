import { useEffect, useState } from "react";
import type { GpuStats } from "../../../src/model.js";
import { api } from "./api.js";

const INTERVAL_MS = 2000;

// The GPU load, read every two seconds while `active`.
export function useGpuStats(active: boolean) {
    const [stats, setStats] = useState<GpuStats>();

    useEffect(() => {
        if (!active) return;
        let stopped = false;
        const read = () => void api.gpuStats().then(current => stopped || setStats(current));
        read();
        const timer = window.setInterval(read, INTERVAL_MS);
        return () => {
            stopped = true;
            window.clearInterval(timer);
            setStats(undefined);
        };
    }, [active]);

    return stats;
}
