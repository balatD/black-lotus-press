import type { OrderCard, ProcessingProfile, TcgCard } from "../../../src/model.js";

const euro = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });

export function formatEuro(amount: number) {
    return euro.format(amount);
}

export function count(amount: number, singular: string, plural = `${singular}s`) {
    return `${amount} ${amount === 1 ? singular : plural}`;
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

export function describeCopyright({ copyrightBehavior, copyrightText }: ProcessingProfile['postProcessing']) {
    switch (copyrightBehavior) {
        case 'keep': return 'copyright line kept';
        case 'blur': return 'copyright line blurred';
        case 'proxy': return 'copyright line blurred, with "Proxy – not for sale"';
        case 'custom': return `copyright line blurred, with "${copyrightText ?? ''}"`;
    }
}

export function describeTcgCard(card: TcgCard) {
    switch (card.tcg) {
        case 'yugioh': return `YGOPRODeck artwork ${card.id}`;
        case 'pokemon': return `TCGdex ${card.id} (${card.lang})`;
        case 'lorcana': return `Lorcast printing ${card.id}`;
        case 'onepiece': return `optcgapi.com artwork ${card.id}`;
    }
}

export function describePrinting(card: OrderCard) {
    const printing = card.printing;
    const tcg = card.tcgCard;
    if (tcg) return describeTcgCard(tcg);
    if (!printing) return 'No Scryfall printing';
    return `${printing.set_name ?? printing.set.toUpperCase()} (${printing.set.toUpperCase()}) #${printing.collector_number}`;
}

export function boardName(board: string) {
    const names: Record<string, string> = {
        commanders: 'Commander', companions: 'Companion', signatureSpells: 'Signature spell', mainboard: 'Main board', extra: 'Extra deck', sideboard: 'Sideboard',
        maybeboard: 'Considering', tokens: 'Token', attractions: 'Attraction', contraptions: 'Contraption', stickers: 'Sticker', planes: 'Plane', schemes: 'Scheme'
    };
    return names[board] ?? board;
}
