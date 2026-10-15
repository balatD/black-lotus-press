import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Search, X } from "lucide-react";
import type { OrderCard, ScryfallCard } from "../../../../src/model.js";
import { faceImageUris } from "../../../../src/pipeline/packs.js";
import { filterPrintings, type PrintingSort, type PrintingStyle, printingPrice, printingStyles, sortPrintings } from "../../../../src/printings.js";
import { api, errorMessage } from "../api.js";
import { formatPrice } from "../format.js";
import { useStoredState } from "../useStoredState.js";
import { ProgressBar } from "./ProgressBar.js";

interface Props {
    card: OrderCard;
    // Copies is less than the card's quantity when only some of them get the printing.
    onChoose(printing: ScryfallCard, copies: number): void;
    onClose(): void;
    nonfoilOnly?: boolean;
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

export function PrintingDialog({ card, onChoose, onClose, nonfoilOnly: startNonfoilOnly = false }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [printings, setPrintings] = useState<ScryfallCard[]>();
    const [error, setError] = useState<string>();
    const [query, setQuery] = useState('');
    const [styles, setStyles] = useState<PrintingStyle[]>([]);
    const [sort, setSort] = useStoredState<PrintingSort>('printings-sort', 'newest');
    const [pricedOnly, setPricedOnly] = useState(false);
    const [nonfoilOnly, setNonfoilOnly] = useState(startNonfoilOnly);
    const [paperOnly, setPaperOnly] = useStoredState('printings-paper-only', true);
    const [copies, setCopies] = useState(card.quantity);

    useEffect(() => {
        dialog.current?.showModal();
        api.searchPrintings({ name: card.name, ...(card.printing ? { printing: card.printing } : {}) })
            .then(setPrintings, e => setError(errorMessage(e)));
    }, [card]);

    const found = printings ?? [];
    const current = found.find(p => p.id === card.printing?.id);
    const shown = sortPrintings(filterPrintings(found.filter(p => p !== current), { query, styles, pricedOnly, paperOnly, nonfoilOnly }), sort);

    const choose = (printing: ScryfallCard) => onChoose(printing, copies);

    function toggleStyle(style: PrintingStyle) {
        setStyles(styles.includes(style) ? styles.filter(s => s !== style) : [...styles, style]);
    }

    return (
        <dialog ref={dialog} className="printing-dialog" onClose={onClose}>
            <header className="dialog-header">
                <div>
                    <h2>Printings of {card.name}</h2>
                    {card.quantity > 1 && (
                        <label className="row">
                            <span className="muted">Change</span>
                            <input className="quantity" type="number" min={1} max={card.quantity} value={copies} aria-label="Copies to change"
                                   onChange={e => setCopies(Math.min(card.quantity, Math.max(1, Math.round(Number(e.target.value)) || 1)))}/>
                            <span className="muted">of {card.quantity} copies{copies < card.quantity ? '; the others keep their printing' : ''}</span>
                        </label>
                    )}
                </div>
                <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
            </header>

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
                {current && <PrintingTile printing={current} isCurrent onChoose={choose}/>}
                {shown.map(printing => <PrintingTile key={printing.id} printing={printing} isCurrent={false} onChoose={choose}/>)}
            </div>
        </dialog>
    );
}

function PrintingTile({ printing, isCurrent, onChoose }: { printing: ScryfallCard, isCurrent: boolean, onChoose(printing: ScryfallCard): void }) {
    const image = faceImageUris(printing, 'front')?.small;
    const unusable = !image || printing.image_status === 'missing' || printing.image_status === 'placeholder';
    const price = printingPrice(printing);
    const year = printing.released_at?.slice(0, 4);
    const styles = printingStyles(printing).map(style => STYLE_NAMES.get(style)).join(', ');

    return (
        <button className={`printing${isCurrent ? ' current' : ''}`} disabled={unusable} aria-pressed={isCurrent} onClick={() => onChoose(printing)}>
            {image ? <img src={image} alt="" loading="lazy"/> : <span className="thumb missing"/>}
            {isCurrent && <span className="printing-current">Current printing</span>}
            <span className="printing-set">{printing.set_name ?? printing.set}</span>
            <span className="meta">{printing.set.toUpperCase()} #{printing.collector_number}{year ? `, ${year}` : ''}</span>
            {styles && <span className="meta">{styles}</span>}
            <span className="printing-price">
                {price ? `${formatPrice(price.amount, price.currency)}${price.foil ? ' foil' : ''}` : 'No price'}
                {printing.image_status === 'lowres' && <span className="warning"> low-res scan</span>}
            </span>
        </button>
    );
}
