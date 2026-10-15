import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GpuStats } from "../model.js";

const run = promisify(execFile);

// Reads the GPU load while Upscayl runs. Values that cannot be read on this computer are left out.
export function gpuStatsReader(temperatureHelper: string | undefined) {
    let sensors: string[] = [];

    return async (): Promise<GpuStats> => {
        if (process.platform !== 'darwin') {
            return parseNvidiaSmi(await output('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits']));
        }

        const [ioreg, helper] = await Promise.all([
            output('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator']),
            temperatureHelper ? output(temperatureHelper, sensors) : undefined
        ]);
        const reading = parseTemperatureHelper(helper);
        if (reading) sensors = reading.sensors;
        return { ...parseUtilization(ioreg), ...(reading ? { temperature: reading.temperature } : {}) };
    };
}

async function output(command: string, args: string[]) {
    try {
        return (await run(command, args, { timeout: 5000 })).stdout;
    } catch {
        return undefined;
    }
}

export function parseUtilization(ioreg: string | undefined): GpuStats {
    const match = ioreg?.match(/"Device Utilization %"=(\d+)/);
    return match ? { utilization: Number(match[1]) } : {};
}

// The helper prints the temperature and the sensor keys it read, which spare the next call the slow search.
export function parseTemperatureHelper(text: string | undefined) {
    const [value, ...sensors] = text?.trim().split(/\s+/) ?? [];
    const temperature = Number.parseFloat(value ?? '');
    return Number.isFinite(temperature) ? { temperature, sensors } : undefined;
}

export function parseNvidiaSmi(text: string | undefined): GpuStats {
    const [utilization, temperature] = (text?.split('\n')[0] ?? '').split(',').map(value => Number.parseFloat(value));
    return {
        ...(utilization !== undefined && Number.isFinite(utilization) ? { utilization } : {}),
        ...(temperature !== undefined && Number.isFinite(temperature) ? { temperature } : {})
    };
}
