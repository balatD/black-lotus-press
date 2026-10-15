import { type CSSProperties, type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { GripVertical, ImageIcon, ImagePlus, ImageUp, LayoutGrid, List, Replace, Search, Sun, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { type Adjustments, changePrinting, combineAdjustments, type Order, type OrderCard, type ScryfallCard } from "../../../../src/model.js";
import { buildPacks, CARDS_PER_PACK, faceImageUris, PACK_PRICE_EUR } from "../../../../src/pipeline/packs.js";
import { printedValue } from "../../../../src/printings.js";
import { api, errorMessage } from "../api.js";
import { count, describePrinting, formatEuro } from "../format.js";
import { PrintingDialog } from "../components/PrintingDialog.js";
import { RegistrationMark } from "../components/Decor.js";
import { useStoredState } from "../useStoredState.js";
import { adjustmentFilter, percent } from "../adjust.js";
import { AdjustmentSliders } from "../components/AdjustmentSliders.js";

interface Props {
    order: Order;
    update(change: (order: Order) => Order): void;
}

type View = 'list' | 'cards';

const ZOOM_MIN = 110;
const ZOOM_MAX = 420;
const ZOOM_STEP = 30;

export function CardsTab({ order, update }: Props) {
    const [filter, setFilter] = useState('');
    const [expanded, setExpanded] = useState<string>();
    const [dragged, setDragged] = useState<number>();
    const [target, setTarget] = useState<number>();
    const [view, setView] = useStoredState<View>('cards-view', 'list');
    const [zoom, setZoom] = useStoredState('cards-zoom', 180);

    if (order.cards.length === 0) {
        return (
            <div className="empty">
                <RegistrationMark size={56} className="empty-mark"/>
                <h2>No cards yet</h2>
                <p>Import the decks on the Setup tab to see their cards here.</p>
            </div>
        );
    }

    const deckNames = new Map(order.decks.map(deck => [deck.url, deck.name ?? deck.url]));
    const filtering = filter.trim() !== '';
    const visible = order.cards
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => !filtering || card.name.toLowerCase().includes(filter.trim().toLowerCase()));
    const opened = view === 'cards' ? order.cards.find(card => card.id === expanded) : undefined;

    function changeCard(id: string, change: (card: OrderCard) => OrderCard) {
        update(current => ({ ...current, cards: current.cards.map(card => card.id === id ? change(card) : card) }));
    }

    function choosePrinting(id: string, printing: ScryfallCard, copies: number) {
        update(current => ({ ...current, cards: changePrinting(current.cards, id, printing, copies) }));
    }

    function move(from: number, to: number) {
        if (to < 0 || to >= order.cards.length || from === to) return;
        update(current => {
            const cards = [...current.cards];
            const [card] = cards.splice(from, 1);
            cards.splice(to, 0, card!);
            return { ...current, cards };
        });
    }

    function dragProps(index: number) {
        return {
            draggable: !filtering,
            onDragStart: () => setDragged(index),
            onDragOver: (event: DragEvent) => {
                event.preventDefault();
                setTarget(index);
            },
            onDragEnd: () => {
                setDragged(undefined);
                setTarget(undefined);
            },
            onDrop: (event: DragEvent) => {
                event.preventDefault();
                if (dragged !== undefined) move(dragged, index);
                setDragged(undefined);
                setTarget(undefined);
            }
        };
    }

    const filterFor = (card: OrderCard) => adjustmentFilter(combineAdjustments(order.adjustments, card.adjustments));
    const setQuantity = (card: OrderCard, quantity: number) => changeCard(card.id, c => ({ ...c, quantity: Math.max(1, quantity || 1) }));
    const setPrinted = (card: OrderCard, printed: boolean) => changeCard(card.id, c => ({ ...c, excluded: !printed }));

    return (
        <div className="cards">
            <Summary order={order}/>

            <div className="toolbar">
                <label className="search grow">
                    <Search/>
                    <input type="search" placeholder="Find a card by name" value={filter} onChange={e => setFilter(e.target.value)}/>
                </label>
                <div className="segmented" role="group" aria-label="View">
                    <button aria-pressed={view === 'list'} onClick={() => setView('list')}><List/>List</button>
                    <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid/>Cards</button>
                </div>
                {view === 'cards' && (
                    <div className="zoom">
                        <button className="quiet" aria-label="Smaller cards" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))}><ZoomOut/></button>
                        <input type="range" aria-label="Card size" min={ZOOM_MIN} max={ZOOM_MAX} step={10} value={zoom} onChange={e => setZoom(Number(e.target.value))}/>
                        <button className="quiet" aria-label="Bigger cards" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))}><ZoomIn/></button>
                    </div>
                )}
            </div>
            <p className="status">{filtering ? 'Clear the search to reorder cards.' : view === 'list'
                ? 'Drag cards or use Alt + arrow keys on the handle to change the print order.'
                : 'Drag cards to change the print order, click a card for its printing and own images.'}</p>

            {view === 'list' ? (
                <ol className="card-list">
                    {visible.map(({ card, index }) => (
                        <li key={card.id} className={`card-row${card.excluded ? ' excluded' : ''}${target === index ? ' drop-target' : ''}`} {...dragProps(index)}>
                            <div className="card-line">
                                <button className="handle" aria-label={`Move ${card.name}`} disabled={filtering}
                                        onKeyDown={event => {
                                            if (!event.altKey) return;
                                            if (event.key === 'ArrowUp') move(index, index - 1);
                                            if (event.key === 'ArrowDown') move(index, index + 1);
                                        }}><GripVertical/></button>
                                <Thumbnail card={card} filter={filterFor(card)}/>
                                <button className="card-name" aria-expanded={expanded === card.id} onClick={() => setExpanded(expanded === card.id ? undefined : card.id)}>
                                    <span className="name">{card.name}</span>
                                    <span className="meta">{describePrinting(card)}</span>
                                </button>
                                <span className="meta deck-board">{deckNames.get(card.deck)}<br/>{boardName(card.board)}</span>
                                <Badges card={card}/>
                                <input className="quantity" type="number" min={1} max={99} value={card.quantity} aria-label={`Copies of ${card.name}`}
                                       onChange={e => setQuantity(card, Number(e.target.value))}/>
                                <label className="print-toggle">
                                    <input type="checkbox" checked={!card.excluded} onChange={e => setPrinted(card, e.target.checked)}/>
                                    <span>Print</span>
                                </label>
                            </div>
                            {expanded === card.id && <CardDetails card={card} orderAdjustments={order.adjustments} onChange={change => changeCard(card.id, change)}
                                                                 onPrinting={(printing, copies) => choosePrinting(card.id, printing, copies)}/>}
                        </li>
                    ))}
                </ol>
            ) : (
                <ol className="card-grid" style={{ '--card-width': `${zoom}px` } as CSSProperties}>
                    {visible.map(({ card, index }) => (
                        <li key={card.id} className={`card-tile${card.excluded ? ' excluded' : ''}${target === index ? ' drop-target' : ''}`} {...dragProps(index)}>
                            <button className="tile-image" aria-label={`${card.name}, ${describePrinting(card)}`} onClick={() => setExpanded(card.id)}>
                                <CardImage card={card} large={zoom > 240} filter={filterFor(card)}/>
                                {card.quantity > 1 && <span className="tile-quantity">×{card.quantity}</span>}
                                {card.excluded && <span className="tile-off">Not printed</span>}
                            </button>
                            <span className="tile-name">{card.name}</span>
                            <Badges card={card}/>
                        </li>
                    ))}
                </ol>
            )}

            {opened && (
                <CardDialog card={opened} deckName={deckNames.get(opened.deck)} orderAdjustments={order.adjustments}
                            onQuantity={quantity => setQuantity(opened, quantity)}
                            onPrinted={printed => setPrinted(opened, printed)}
                            onChange={change => changeCard(opened.id, change)}
                            onPrinting={(printing, copies) => choosePrinting(opened.id, printing, copies)}
                            onClose={() => setExpanded(undefined)}/>
            )}
        </div>
    );
}

function CardImage({ card, large, filter }: { card: OrderCard, large: boolean, filter: string }) {
    const uris = card.printing && faceImageUris(card.printing, 'front');
    const src = card.customImage ? `preview://image/${encodeURIComponent(card.customImage.front)}` : large ? uris?.large : uris?.normal;
    return src ? <img src={src} alt="" loading="lazy" style={{ filter }}/> : <span className="tile-missing">No image</span>;
}

interface CardDialogProps {
    card: OrderCard;
    deckName: string | undefined;
    orderAdjustments: Adjustments;
    onQuantity(quantity: number): void;
    onPrinted(printed: boolean): void;
    onChange(change: (card: OrderCard) => OrderCard): void;
    onPrinting(printing: ScryfallCard, copies: number): void;
    onClose(): void;
}

function CardDialog({ card, deckName, orderAdjustments, onQuantity, onPrinted, onChange, onPrinting, onClose }: CardDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        dialog.current?.showModal();
        // The dialog itself takes the focus, so Close does not light up as if it were the main action.
        dialog.current?.focus();
    }, []);

    return (
        // React passes the close event of the printing dialog inside on to this one.
        <dialog ref={dialog} className="card-dialog" tabIndex={-1} onClose={event => event.target === event.currentTarget && onClose()}>
            <header className="dialog-header">
                <div>
                    <h2>{card.name}</h2>
                    <span className="meta">{describePrinting(card)}, {deckName}, {boardName(card.board)}</span>
                </div>
                <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
            </header>
            <CardDetails card={card} orderAdjustments={orderAdjustments} onChange={onChange} onPrinting={onPrinting}>
                <div className="row">
                    <label className="row">
                        <span className="muted">Copies</span>
                        <input className="quantity" type="number" min={1} max={99} value={card.quantity} onChange={e => onQuantity(Number(e.target.value))}/>
                    </label>
                    <label className="print-toggle">
                        <input type="checkbox" checked={!card.excluded} onChange={e => onPrinted(e.target.checked)}/>
                        <span>Print</span>
                    </label>
                    <Badges card={card}/>
                </div>
            </CardDetails>
        </dialog>
    );
}

function Summary({ order }: { order: Order }) {
    const { packs, droppedTokens } = buildPacks(order);
    const slots = packs.flat();
    const printed = slots.filter(slot => slot.cardId !== undefined).length;
    const blank = slots.length - printed;
    const excluded = order.cards.filter(card => card.excluded).length;
    const missing = order.cards.filter(card => !card.excluded && !card.printing && !card.customImage).length;
    const lowRes = order.cards.filter(card => !card.excluded && !card.customImage && card.printing?.image_status === 'lowres').length;
    const value = printedValue(order);

    return (
        <div className="summary">
            <p className="headline">
                {count(printed, 'card')} fill {count(packs.length, 'pack')} of {CARDS_PER_PACK}, about{' '}
                {value > 0 && <><s title="Cardmarket value of the printed cards">{formatEuro(value)}</s>{' '}</>}
                {formatEuro(packs.length * PACK_PRICE_EUR)} plus shipping.
            </p>
            {blank > 0 && <p>{count(blank, 'slot stays', 'slots stay')} blank.</p>}
            {droppedTokens.length > 0 && (
                <p>Left out because they would need another pack: {droppedTokens.map(token => token.copies > 1 ? `${token.card.name} ×${token.copies}` : token.card.name).join(', ')}.</p>
            )}
            {excluded > 0 && <p className="muted">{count(excluded, 'card is', 'cards are')} switched off.</p>}
            {missing > 0 && <p className="error">{count(missing, 'card was', 'cards were')} not found on Scryfall and will not be printed. Pick another printing or an own image.</p>}
            {lowRes > 0 && <p className="warning">{count(lowRes, 'card only has a', 'cards only have')} low-resolution scan{lowRes === 1 ? '' : 's'} and may print blurry.</p>}
        </div>
    );
}

function Thumbnail({ card, filter }: { card: OrderCard, filter: string }) {
    const src = card.customImage
        ? `preview://image/${encodeURIComponent(card.customImage.front)}`
        : card.printing && faceImageUris(card.printing, 'front')?.small;
    return src ? <img className="thumb" src={src} alt="" loading="lazy" style={{ filter }}/> : <span className="thumb missing"/>;
}

function Badges({ card }: { card: OrderCard }) {
    const badges: [string, string][] = [];
    if (card.printing && faceImageUris(card.printing, 'back')) badges.push(['Double-faced', '']);
    if (card.isToken) badges.push(['Token', '']);
    if (card.customImage) badges.push(['Own image', 'own']);
    if (!card.customImage && card.printing?.image_status === 'lowres') badges.push(['Low-res', 'warning']);
    if (!card.printing && !card.customImage) badges.push(['Not on Scryfall', 'error']);

    return <span className="badges">{badges.map(([label, kind]) => <span key={label} className={`badge ${kind}`}>{label}</span>)}</span>;
}

interface CardDetailsProps {
    card: OrderCard;
    orderAdjustments: Adjustments;
    onChange(change: (card: OrderCard) => OrderCard): void;
    onPrinting(printing: ScryfallCard, copies: number): void;
    // Shown above the controls.
    children?: ReactNode;
}

function CardDetails({ card, orderAdjustments, onChange, onPrinting, children }: CardDetailsProps) {
    const [choosingPrinting, setChoosingPrinting] = useState(false);
    const [error, setError] = useState<string>();
    const effective = combineAdjustments(orderAdjustments, card.adjustments);
    const filter = adjustmentFilter(effective);
    const front = card.customImage ? `preview://image/${encodeURIComponent(card.customImage.front)}` : card.printing && faceImageUris(card.printing, 'front')?.normal;
    const back = card.customImage?.back ? `preview://image/${encodeURIComponent(card.customImage.back)}` : card.printing && faceImageUris(card.printing, 'back')?.normal;

    async function pickImage(face: 'front' | 'back') {
        setError(undefined);
        try {
            const file = await api.pickCustomImage();
            if (!file) return;
            onChange(current => ({ ...current, customImage: face === 'front' ? { ...current.customImage, front: file } : { front: current.customImage?.front ?? file, back: file } }));
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    function removeImages() {
        onChange(({ customImage: _, ...rest }) => rest);
    }

    return (
        <div className="card-details">
            <div className="card-faces">
                <figure className="proof">
                    {front ? <img src={front} alt={`${card.name} front`} style={{ filter }}/> : <div className="placeholder">No image</div>}
                    {back && <figcaption className="meta">Front</figcaption>}
                </figure>
                {back && (
                    <figure className="proof">
                        <img src={back} alt={`${card.name} back`} style={{ filter }}/>
                        <figcaption className="meta">Back</figcaption>
                    </figure>
                )}
            </div>
            <div className="card-controls">
                {children}
                <section>
                    <h3><ImageIcon/>Image</h3>
                    <p className="status">{card.customImage
                        ? 'Printed from your own image. Images with the page format 69 × 94 mm already contain the bleed, card-sized images get a mirrored 3 mm bleed.'
                        : 'Printed from the Scryfall scan of this printing.'}</p>
                    <div className="row">
                        <button onClick={() => setChoosingPrinting(true)}><Replace/>Change printing…</button>
                        <button onClick={() => void pickImage('front')}><ImagePlus/>Own front image…</button>
                        <button onClick={() => void pickImage('back')}><ImageUp/>Own back image…</button>
                        {card.customImage && <button className="quiet danger" onClick={removeImages}><Undo2/>Use Scryfall again</button>}
                    </div>
                    {error && <span className="status error">{error}</span>}
                </section>
                <section>
                    <h3><Sun/>Brightness and contrast of this card</h3>
                    <AdjustmentSliders
                        adjustments={card.adjustments ?? { brightness: 1, contrast: 1 }}
                        onChange={adjustments => onChange(current => ({ ...current, adjustments }))}
                        onReset={() => onChange(({ adjustments: _, ...rest }) => rest)}
                        resetLabel="Use the order's values"
                        canReset={card.adjustments !== undefined}/>
                    <p className="status">
                        On top of the order's {percent(orderAdjustments.brightness)} brightness and {percent(orderAdjustments.contrast)} contrast,
                        this card prints at {percent(effective.brightness)} and {percent(effective.contrast)}. The preview shows it approximately.
                    </p>
                </section>
            </div>
            {choosingPrinting && (
                <PrintingDialog card={card}
                                onClose={() => setChoosingPrinting(false)}
                                onChoose={(printing, copies) => {
                                    onPrinting(printing, copies);
                                    setChoosingPrinting(false);
                                }}/>
            )}
        </div>
    );
}

function boardName(board: string) {
    const names: Record<string, string> = {
        commanders: 'Commander', companions: 'Companion', signatureSpells: 'Signature spell', mainboard: 'Main board', sideboard: 'Sideboard',
        maybeboard: 'Considering', tokens: 'Token', attractions: 'Attraction', contraptions: 'Contraption', stickers: 'Sticker', planes: 'Plane', schemes: 'Scheme'
    };
    return names[board] ?? board;
}
