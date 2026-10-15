import type { OrderCard } from "../../../src/model.js";

const euro = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });

export function formatEuro(amount: number) {
    return euro.format(amount);
}

export function count(amount: number, singular: string, plural = `${singular}s`) {
    return `${amount} ${amount === 1 ? singular : plural}`;
}

export function formatMegabytes(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const currencies = new Map<string, Intl.NumberFormat>();

export function formatPrice(amount: number, currency: string) {
    let format = currencies.get(currency);
    if (!format) {
        format = new Intl.NumberFormat(undefined, { style: 'currency', currency });
        currencies.set(currency, format);
    }
    return format.format(amount);
}

// What the profile does with the images, in the words the screens use.
export function describeProcessing(profile: { postProcessing: { dpi: number }, upscaling: { enabled: boolean } }) {
    const dpi = profile.postProcessing.dpi;
    if (!profile.upscaling.enabled) return `${dpi} dpi, no upscaling`;
    return dpi > 300 ? `${dpi} dpi, upscaled with Upscayl` : `${dpi} dpi; Upscayl is on but only runs above 300 dpi`;
}

export function describePrinting(card: OrderCard) {
    const printing = card.printing;
    if (!printing) return 'No Scryfall printing';
    return `${printing.set_name ?? printing.set.toUpperCase()} (${printing.set.toUpperCase()}) #${printing.collector_number}`;
}
