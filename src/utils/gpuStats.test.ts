import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNvidiaSmi, parseTemperatureHelper, parseUtilization } from "./gpuStats.js";

test('parseUtilization reads the device utilization of the Apple GPU from ioreg', () => {
    const ioreg = '"PerformanceStatistics" = {"Tiler Utilization %"=10,"Renderer Utilization %"=11,"Device Utilization %"=87,"In use system memory"=123}';

    assert.deepEqual(parseUtilization(ioreg), { utilization: 87 });
    assert.deepEqual(parseUtilization(undefined), {});
});

test('parseTemperatureHelper reads the hottest sensor and the sensor keys for the next reading', () => {
    assert.deepEqual(parseTemperatureHelper('57.5 Tg04 Tg05\n'), { temperature: 57.5, sensors: ['Tg04', 'Tg05'] });
    assert.equal(parseTemperatureHelper(''), undefined);
    assert.equal(parseTemperatureHelper(undefined), undefined);
});

test('parseNvidiaSmi reads utilization and temperature of the first NVIDIA GPU', () => {
    assert.deepEqual(parseNvidiaSmi('93, 71\n12, 40\n'), { utilization: 93, temperature: 71 });
    assert.deepEqual(parseNvidiaSmi('[N/A], 64\n'), { temperature: 64 });
    assert.deepEqual(parseNvidiaSmi(undefined), {});
});
