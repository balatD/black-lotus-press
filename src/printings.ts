import type { Order, ScryfallCard } from "./model.js";
import { buildPacks } from "./pipeline/packs.js";

export type PrintingSort = 'newest' | 'oldest' | 'cheapest' | 'priciest' | 'set';
export type PrintingStyle = 'borderless' | 'fullArt' | 'extendedArt' | 'showcase' | 'oldFrame';

export interface PrintingFilter {
    query: string;
    styles: PrintingStyle[];
    pricedOnly: boolean;
    paperOnly: boolean;
    nonfoilOnly: boolean;
}

export interface Price {
    amount: number;
    currency: 'EUR' | 'USD';
    // Foil-only printings (e.g. Masterpieces) only have a foil price.
    foil: boolean;
}

const PRICE_ORDER = [['eur', 'EUR', false], ['usd', 'USD', false], ['eur_foil', 'EUR', true], ['usd_foil', 'USD', true]] as const;

// Cardmarket's euro price when there is one, otherwise the US price; foil prices only when there is no other.
export function printingPrice(printing: ScryfallCard): Price | undefined {
    for (const [field, currency, foil] of PRICE_ORDER) {
        const amount = Number.parseFloat(printing.prices?.[field] ?? '');
        if (!Number.isNaN(amount)) return { amount, currency, foil };
    }
    return undefined;
}

// What the printed copies cost at their printing's euro price; copies without one are left out.
export function printedValue(order: Order) {
    const cards = new Map(order.cards.map(card => [card.id, card]));
    return buildPacks(order).packs.flat().reduce((total, slot) => {
        const printing = slot.cardId === undefined ? undefined : cards.get(slot.cardId)?.printing;
        const price = printing && printingPrice(printing);
        return total + (price?.currency === 'EUR' ? price.amount : 0);
    }, 0);
}

export function printingStyles(printing: ScryfallCard): PrintingStyle[] {
    const styles: PrintingStyle[] = [];
    if (printing.border_color === 'borderless') styles.push('borderless');
    if (printing.full_art) styles.push('fullArt');
    if (printing.frame_effects?.includes('extendedart')) styles.push('extendedArt');
    if (printing.frame_effects?.includes('showcase')) styles.push('showcase');
    if (printing.frame === '1993' || printing.frame === '1997') styles.push('oldFrame');
    return styles;
}

export function filterPrintings(printings: ScryfallCard[], filter: PrintingFilter) {
    const query = filter.query.trim().toLowerCase();

    return printings.filter(printing =>
        (!query || printing.set.toLowerCase() === query || (printing.set_name ?? '').toLowerCase().includes(query))
        && (filter.styles.length === 0 || printingStyles(printing).some(style => filter.styles.includes(style)))
        && (!filter.pricedOnly || printingPrice(printing) !== undefined)
        && (!filter.paperOnly || !printing.digital)
        && (!filter.nonfoilOnly || printing.finishes?.includes('nonfoil') !== false));
}

// Printings without a price go last when sorting by price.
export function sortPrintings(printings: ScryfallCard[], sort: PrintingSort) {
    const released = (printing: ScryfallCard) => printing.released_at ?? '';
    const price = (printing: ScryfallCard) => printingPrice(printing)?.amount;

    return [...printings].sort((a, b) => {
        switch (sort) {
            case 'newest':
                return released(b).localeCompare(released(a));
            case 'oldest':
                return released(a).localeCompare(released(b));
            case 'set':
                return (a.set_name ?? a.set).localeCompare(b.set_name ?? b.set) || a.collector_number.localeCompare(b.collector_number, undefined, { numeric: true });
            case 'cheapest':
            case 'priciest': {
                const [pa, pb] = [price(a), price(b)];
                if (pa === undefined || pb === undefined) return pa === undefined ? (pb === undefined ? 0 : 1) : -1;
                return sort === 'cheapest' ? pa - pb : pb - pa;
            }
        }
    });
}
