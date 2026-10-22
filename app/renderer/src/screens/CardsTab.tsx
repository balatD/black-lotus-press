import { type CSSProperties, type DragEvent, useState } from "react";
import { CircleStop, GripVertical, Images, LayoutGrid, List, ListPlus, Plus, Search, ZoomIn, ZoomOut } from "lucide-react";
import { combineAdjustments, type Order, type OrderCard, type ScryfallCard } from "../../../../src/model.js";
import { buildPacks, cardFaces, CARDS_PER_PACK, faceImageUris, fillFreeSlots, mpcfillImage, packPrice, shopDeck } from "../../../../src/pipeline/packs.js";
import { printedValue } from "../../../../src/printings.js";
import { api, errorMessage, wasStopped } from "../api.js";
import { boardName, count, describePrinting, formatEuro } from "../format.js";
import { CardEditor } from "../components/CardEditor.js";
import { lacksMpcfill, MpcfillReview } from "../components/MpcfillReview.js";
import { RegistrationMark } from "../components/Decor.js";
import { TokenPicker } from "../components/TokenPicker.js";
import { useStoredState } from "../useStoredState.js";
import { adjustmentFilter } from "../adjust.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { useTasks } from "../useTasks.js";
import { useProgress } from "../useProgress.js";

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
    const [editing, setEditing] = useState<string>();
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

    function changeCard(id: string, change: (card: OrderCard) => OrderCard) {
        update(current => ({ ...current, cards: current.cards.map(card => card.id === id ? change(card) : card) }));
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
            <Summary order={order} update={update}/>

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
            <SharpestImages order={order} update={update}/>
            <p className="status">{filtering ? 'Clear the search to reorder cards.' : view === 'list'
                ? 'Drag cards or use Alt + arrow keys on the handle to change the print order.'
                : 'Drag cards to change the print order, click a card to choose its image, copies and brightness.'}</p>

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
                                <button className="card-name" aria-haspopup="dialog" onClick={() => setEditing(card.id)}>
                                    <span className="name">{card.name}</span>
                                    <span className="meta">{describePrinting(card)}</span>
                                </button>
                                <span className="meta deck-board">{deckNames.get(card.deck) ?? 'Added here'}<br/>{boardName(card.board)}</span>
                                <Badges card={card}/>
                                <input className="quantity" type="number" min={1} max={99} value={card.quantity} aria-label={`Copies of ${card.name}`}
                                       onChange={e => setQuantity(card, Number(e.target.value))}/>
                                <label className="print-toggle">
                                    <input type="checkbox" checked={!card.excluded} onChange={e => setPrinted(card, e.target.checked)}/>
                                    <span>Print</span>
                                </label>
                            </div>
                        </li>
                    ))}
                </ol>
            ) : (
                <ol className="card-grid" style={{ '--card-width': `${zoom}px` } as CSSProperties}>
                    {visible.map(({ card, index }) => (
                        <li key={card.id} className={`card-tile${card.excluded ? ' excluded' : ''}${target === index ? ' drop-target' : ''}`} {...dragProps(index)}>
                            <button className="tile-image" aria-label={`${card.name}, ${describePrinting(card)}`} onClick={() => setEditing(card.id)}>
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

            {editing && <CardEditor order={order} update={update} ids={visible.map(({ card }) => card.id)} start={editing} onClose={() => setEditing(undefined)}/>}
        </div>
    );
}

// The image a face is printed from, in the same order as the processing: own image, MPC Autofill image, Scryfall scan.
function faceImage(card: OrderCard, face: 'front' | 'back', size: 'small' | 'normal' | 'large') {
    const own = face === 'front' ? card.customImage?.front : card.customImage?.back;
    if (own) return `preview://image/${encodeURIComponent(own)}`;
    const mpcfill = card.mpcfill?.[face];
    if (mpcfill) return mpcfillImage(mpcfill, size === 'small' ? 'small' : 'large');
    return card.printing && faceImageUris(card.printing, face)?.[size];
}

// For every card without an image of its own, the sharpest MPC Autofill image that shows its printing.
function SharpestImages({ order, update }: Props) {
    const tasks = useTasks();
    const running = tasks.find(task => task.kind !== 'browser');
    const job = running?.kind === 'mpcfill' && running.order === order.name ? running : undefined;
    const progress = useProgress(job !== undefined);
    const [result, setResult] = useState<string>();
    const [error, setError] = useState<string>();
    const [reviewing, setReviewing] = useState(false);
    const missing = order.cards.filter(lacksMpcfill).length;

    async function pick() {
        if (!window.confirm('Use the sharpest MPC Autofill image that shows the printing for every printed card? Cards with an own or MPC Autofill image keep it, '
            + 'cards without a matching image keep their Scryfall scan. Large decks take a few minutes.')) return;
        const open = order.cards.filter(card => !card.excluded && card.printing && !card.customImage && !card.mpcfill).length;
        setResult(undefined);
        setError(undefined);
        try {
            const picks = await api.pickMpcfillImages(order);
            const withPick = (card: OrderCard) => picks[card.id] && !card.customImage && !card.mpcfill ? { ...card, mpcfill: picks[card.id]! } : card;
            update(current => ({ ...current, cards: current.cards.map(withPick) }));
            setResult(`Found MPC Autofill images for ${Object.keys(picks).length} of ${count(open, 'card')}.`);
            // The cards left over are picked by hand, from images of other printings.
            if (order.cards.map(withPick).some(lacksMpcfill)) setReviewing(true);
        } catch (e) {
            if (!wasStopped(e)) setError(errorMessage(e));
        }
    }

    return (
        <div className="sharpest">
            <div className="row">
                <button disabled={running !== undefined} onClick={() => void pick()}><Images/>Use the sharpest MPC Autofill images</button>
                {job && <button className="quiet" onClick={() => void api.stopTask(job.id)}><CircleStop/>Cancel</button>}
                {!job && missing > 0 && <button className="quiet" onClick={() => setReviewing(true)}>Cards without an MPC Autofill image ({missing})</button>}
                {result && <span className="status">{result}</span>}
                {error && <span className="status error">{error}</span>}
            </div>
            {job && <ProgressBar progress={progress} label="Looking for MPC Autofill images"/>}
            {reviewing && <MpcfillReview order={order} update={update} onClose={() => setReviewing(false)}/>}
        </div>
    );
}

function CardImage({ card, large, filter }: { card: OrderCard, large: boolean, filter: string }) {
    const src = faceImage(card, 'front', large ? 'large' : 'normal');
    return src ? <img src={src} alt="" loading="lazy" style={{ filter }}/> : <span className="tile-missing">No image</span>;
}

function Summary({ order, update }: Props) {
    const [findingToken, setFindingToken] = useState(false);
    const { packs, droppedTokens } = buildPacks(order);
    const slots = packs.flat();
    const printed = slots.filter(slot => slot.cardId !== undefined).length;
    const blank = slots.length - printed;
    const excluded = order.cards.filter(card => card.excluded).length;
    const missing = order.cards.filter(card => !card.excluded && !card.printing && !card.customImage).length;
    const lowRes = order.cards.filter(card => !card.excluded && !card.customImage && !card.mpcfill?.front && card.printing?.image_status === 'lowres').length;
    const value = printedValue(order);
    const price = packs.reduce((total, pack) => total + packPrice(order.shop, pack.length), 0);
    const { shop } = order;
    // The tokens that print, whose copies fill the blank slots first.
    const tokens = order.cards.filter(card => card.isToken && !card.excluded && cardFaces(card, order));

    function addCopy(id: string) {
        update(current => ({ ...current, cards: current.cards.map(card => card.id === id ? { ...card, quantity: card.quantity + 1 } : card) }));
    }

    // A token found on Scryfall belongs to no deck, so updating the decks from Moxfield keeps it.
    function addToken(printing: ScryfallCard) {
        const existing = order.cards.find(card => card.isToken && card.printing?.id === printing.id && !card.customImage && !card.mpcfill);
        if (existing) return addCopy(existing.id);
        const token: OrderCard = { id: crypto.randomUUID(), deck: '', board: 'tokens', name: printing.name, quantity: 1, isToken: true, excluded: false, printing };
        update(current => ({ ...current, cards: [...current.cards, token] }));
    }

    const packing = shop === 'meinspiel'
        ? `${count(packs.length, 'pack')} of ${CARDS_PER_PACK}`
        : `${count(packs.length, 'deck')} of up to ${packs.map(pack => shopDeck(shop, pack.length)[0]).join(', ')}`;

    return (
        <div className="summary">
            <p className="headline">
                {count(printed, 'card')} fill {packing}, about{' '}
                {value > 0 && <><s title="Cardmarket value of the printed cards">{formatEuro(value)}</s>{' '}</>}
                {formatEuro(price)} plus shipping.
            </p>
            {blank > 0 && (
                <div className="free-slots">
                    <p>{count(blank, 'slot')}{packs.length > 1 ? ` of pack ${packs.length}` : ''} {blank === 1 ? 'stays' : 'stay'} blank. Fill {blank === 1 ? 'it' : 'them'} with tokens:</p>
                    <div className="row">
                        {tokens.map(token => (
                            <button key={token.id} className="token-copy" aria-label={`Add a copy of ${token.name}`} onClick={() => addCopy(token.id)}>
                                <Thumbnail card={token} filter={adjustmentFilter(combineAdjustments(order.adjustments, token.adjustments))}/>
                                <span>{token.name}<span className="meta"> ×{token.quantity}</span></span>
                                <Plus/>
                            </button>
                        ))}
                        {tokens.length > 0 && <button onClick={() => update(current => ({ ...current, cards: fillFreeSlots(current) }))}><ListPlus/>Fill all blank slots</button>}
                        <button className="quiet" onClick={() => setFindingToken(true)}><Search/>Find a token…</button>
                    </div>
                </div>
            )}
            {findingToken && <TokenPicker onPick={addToken} onClose={() => setFindingToken(false)}/>}
            {droppedTokens.length > 0 && (
                <p>Left out because they would need {order.shop === 'meinspiel' ? 'another pack' : 'a larger deck'}: {droppedTokens.map(token => token.copies > 1 ? `${token.card.name} ×${token.copies}` : token.card.name).join(', ')}.</p>
            )}
            {excluded > 0 && <p className="muted">{count(excluded, 'card is', 'cards are')} switched off.</p>}
            {missing > 0 && <p className="error">{count(missing, 'card was', 'cards were')} not found on Scryfall and will not be printed. Pick another printing or an own image.</p>}
            {lowRes > 0 && <p className="warning">{count(lowRes, 'card only has a', 'cards only have')} low-resolution scan{lowRes === 1 ? '' : 's'} and may print blurry.</p>}
        </div>
    );
}

function Thumbnail({ card, filter }: { card: OrderCard, filter: string }) {
    const src = faceImage(card, 'front', 'small');
    return src ? <img className="thumb" src={src} alt="" loading="lazy" style={{ filter }}/> : <span className="thumb missing"/>;
}

function Badges({ card }: { card: OrderCard }) {
    const badges: [string, string][] = [];
    if (card.printing && faceImageUris(card.printing, 'back')) badges.push(['Double-faced', '']);
    if (card.isToken) badges.push(['Token', '']);
    if (card.customImage) badges.push(['Own image', 'own']);
    if (card.mpcfill) badges.push(['MPC Autofill', 'own']);
    if (!card.customImage && !card.mpcfill?.front && card.printing?.image_status === 'lowres') badges.push(['Low-res', 'warning']);
    if (!card.printing && !card.customImage) badges.push(['Not on Scryfall', 'error']);

    return <span className="badges">{badges.map(([label, kind]) => <span key={label} className={`badge ${kind}`}>{label}</span>)}</span>;
}
