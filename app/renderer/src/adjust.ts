import type { Adjustments } from "../../../src/model.js";

// Same formula as the print conversion, so unprocessed previews show the adjustments.
export function adjustmentFilter(adjustments: Adjustments) {
    return `brightness(${adjustments.brightness}) contrast(${adjustments.contrast})`;
}

export function percent(value: number) {
    return `${Math.round(value * 100)} %`;
}
