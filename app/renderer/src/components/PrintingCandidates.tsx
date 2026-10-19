import { useEffect, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";
import type { OrderCard, ScryfallCard } from "../../../../src/model.js";
import { faceImageUris } from "../../../../src/pipeline/packs.js";
import { filterPrintings, type PrintingSort, type PrintingStyle, printingPrice, printingStyles, sortPrintings } from "../../../../src/printings.js";
import { api, errorMessage } from "../api.js";
import { formatPrice } from "../format.js";
import { useStoredState } from "../useStoredState.js";
import { ProgressBar } from "./ProgressBar.js";

interface Props {
    card: OrderCard;
    face: 'front' | 'back';
    selected: string | undefined;
    nonfoilOnly: boolean;
    onSelect(printing: ScryfallCard): void;
    onUse(printing: ScryfallCard): void;
}

const SORTS: [PrintingSort, string][] = [
    ['newest', 'Newest first'],
    ['oldest', 'Oldest first'],
    ['cheapest', 'Cheapest first'],
    ['priciest', 'Most expensive first'],
    ['set', 'Set name']
];

const STYLES: [PrintingStyle, string][] = [
    ['borderless', 'Borderless'],
    ['fullArt', 'Full art'],
    ['extendedArt', 'Extended art'],
    ['showcase', 'Showcase'],
    ['oldFrame', 'Old frame']
];

const STYLE_NAMES = new Map(STYLES);

const searches = new Map<string, Promise<ScryfallCard[]>>();

// Searched once per card name while the app runs; a failed search is tried again next time.
// The search only finds English printings, so the card's own printing is added.
export async function printingsOf(card: Pick<OrderCard, 'name' | 'printing'>): Promise<ScryfallCard[]> {
    let search = searches.get(card.name);
    if (!search) {
        search = api.searchPrintings({ name: card.name, ...(card.printing ? { printing: card.printing } : {}) });
        search.catch(() => searches.delete(card.name));
        searches.set(card.name, search);
    }
    const found = await search;
    return !card.printing || found.some(printing => printing.id === card.printing!.id) ? found : [card.printing, ...found];
}

export function PrintingCandidates({ card, face, selected, nonfoilOnly: startNonfoilOnly, onSelect, onUse }: Props) {
    const [printings, setPrintings] = useState<ScryfallCard[]>();
    const [error, setError] = useState<string>();
    const [query, setQuery] = useState('');
    const [styles, setStyles] = useState<PrintingStyle[]>([]);
    const [sort, setSort] = useStoredState<PrintingSort>('printings-sort', 'newest');
    const [pricedOnly, setPricedOnly] = useState(false);
    const [nonfoilOnly, setNonfoilOnly] = useState(startNonfoilOnly);
    const [paperOnly, setPaperOnly] = useStoredState('printings-paper-only', true);

    useEffect(() => {
        let closed = false;
        printingsOf(card).then(found => !closed && setPrintings(found), e => !closed && setError(errorMessage(e)));
        return () => {
            closed = true;
        };
    }, [card.name]);

    const found = printings ?? [];
    const current = found.find(p => p.id === card.printing?.id);
    const shown = sortPrintings(filterPrintings(found.filter(p => p !== current), { query, styles, pricedOnly, paperOnly, nonfoilOnly }), sort);
    const tile = (printing: ScryfallCard) => (
        <PrintingTile key={printing.id} printing={printing} face={face} isCurrent={printing === current} isSelected={printing.id === selected} onSelect={onSelect} onUse={onUse}/>
    );

    function toggleStyle(style: PrintingStyle) {
        setStyles(styles.includes(style) ? styles.filter(s => s !== style) : [...styles, style]);
    }

    return (
        <>
            <div className="filters">
                <label className="search">
                    <Search/>
                    <input type="search" placeholder="Set name or code" value={query} onChange={e => setQuery(e.target.value)}/>
                </label>
                <label className="row">
                    <span className="muted with-icon"><ArrowUpDown/>Sort</span>
                    <select value={sort} onChange={e => setSort(e.target.value as PrintingSort)}>
                        {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </label>
                <div className="chips" role="group" aria-label="Frame styles">
                    {STYLES.map(([style, label]) => (
                        <button key={style} className="chip" aria-pressed={styles.includes(style)} onClick={() => toggleStyle(style)}>{label}</button>
                    ))}
                </div>
                <label className="row"><input type="checkbox" checked={pricedOnly} onChange={e => setPricedOnly(e.target.checked)}/><span>With a price</span></label>
                <label className="row"><input type="checkbox" checked={nonfoilOnly} onChange={e => setNonfoilOnly(e.target.checked)}/><span>Non-foil only</span></label>
                <label className="row"><input type="checkbox" checked={paperOnly} onChange={e => setPaperOnly(e.target.checked)}/><span>Paper printings only</span></label>
            </div>

            {error && <p className="error">{error}</p>}
            {!printings && !error && <ProgressBar progress={undefined} label="Searching Scryfall for all printings"/>}
            {printings && (
                <p className="status">
                    {shown.length} of {found.length - (current ? 1 : 0)} other printings shown. Prices are Cardmarket trend prices in euros from Scryfall, otherwise US prices; printings that only exist as foil show their foil price.
                </p>
            )}

            <div className="printing-grid">
                {current && tile(current)}
                {shown.map(tile)}
            </div>
        </>
    );
}

function PrintingTile({ printing, face, isCurrent, isSelected, onSelect, onUse }: {
    printing: ScryfallCard, face: 'front' | 'back', isCurrent: boolean, isSelected: boolean, onSelect(printing: ScryfallCard): void, onUse(printing: ScryfallCard): void
}) {
    const image = faceImageUris(printing, face)?.normal;
    const unusable = !image || printing.image_status === 'missing' || printing.image_status === 'placeholder';
    const price = printingPrice(printing);
    const year = printing.released_at?.slice(0, 4);
    const styles = printingStyles(printing).map(style => STYLE_NAMES.get(style)).join(', ');

    return (
        <button className={`printing${isCurrent ? ' current' : ''}`} disabled={unusable} aria-pressed={isSelected} onClick={() => onSelect(printing)} onDoubleClick={() => onUse(printing)}>
            {image ? <img src={image} alt="" loading="lazy"/> : <span className="thumb missing"/>}
            {isCurrent && <span className="printing-current">Current printing</span>}
            <span className="printing-set">{printing.set_name ?? printing.set}</span>
            <span className="meta">{printing.set.toUpperCase()} #{printing.collector_number}{year ? `, ${year}` : ''}</span>
            {styles && <span className="meta">{styles}</span>}
            <span className="printing-price">{price ? `${formatPrice(price.amount, price.currency)}${price.foil ? ' foil' : ''}` : 'No price'}</span>
            {printing.image_status === 'lowres' && <span className="badge warning">Low-res scan</span>}
        </button>
    );
}
