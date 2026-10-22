import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Columns2, ImagePlus, ImageUp, Trash2, Undo2, X } from "lucide-react";
import { changePrinting, chooseMpcfillImage, combineAdjustments, type Order, type OrderCard, type ScryfallCard } from "../../../../src/model.js";
import type { MpcfillCard } from "../../../../src/clients/mpcfill.js";
import { cardFaces, faceImageUris, mpcfillImage } from "../../../../src/pipeline/packs.js";
import { api, errorMessage } from "../api.js";
import { adjustmentFilter, percent } from "../adjust.js";
import { boardName, count, describePrinting } from "../format.js";
import { useStoredState } from "../useStoredState.js";
import { AdjustmentSliders } from "./AdjustmentSliders.js";
import { ImageStage, type Pane } from "./ImageStage.js";
import { MpcfillCandidates, mpcfillSearchKey } from "./MpcfillCandidates.js";
import { PrintingCandidates } from "./PrintingCandidates.js";

type Tab = 'printings' | 'mpcfill' | 'own';
type Face = 'front' | 'back';

// An image the stage shows: the face's current one or one picked on a tab.
type Candidate =
    | { type: 'scryfall', printing: ScryfallCard }
    // The printing is the one the image shows, if it was recognised.
    | { type: 'mpcfill', id: string, image: MpcfillCard | undefined, printing: ScryfallCard | undefined }
    | { type: 'custom', image: string };

interface Props {
    order: Order;
    update(change: (order: Order) => Order): void;
    // The cards Previous card and Next card step through.
    ids: string[];
    start: string;
    tab?: Tab;
    face?: Face;
    nonfoilOnly?: boolean;
    onClose(): void;
}

const TABS: [Tab, string][] = [['printings', 'Printings'], ['mpcfill', 'MPC Autofill'], ['own', 'Own image']];
const TILE_MIN = 110;
const TILE_MAX = 300;

export function CardEditor({ order, update, ids, start, tab: startTab, face: startFace = 'front', nonfoilOnly = false, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const candidates = useRef<HTMLDivElement>(null);
    const [id, setId] = useState(start);
    const card = order.cards.find(c => c.id === id);
    const [tab, setTab] = useState<Tab>(() => startTab ?? (card?.customImage ? 'own' : card?.mpcfill?.[startFace] ? 'mpcfill' : 'printings'));
    const [face, setFace] = useState<Face>(startFace);
    const [selected, setSelected] = useState<Candidate>();
    const [comparing, setComparing] = useState(false);
    // Undefined while all copies change.
    const [copies, setCopies] = useState<number>();
    const [error, setError] = useState<string>();
    const [tileWidth, setTileWidth] = useStoredState('editor-tile-width', 150);

    useEffect(() => {
        dialog.current?.showModal();
        // The dialog itself takes the focus, so the keys work at once and Close does not light up as if it were the main action.
        dialog.current?.focus();
    }, []);

    if (!card) return null;

    const index = ids.indexOf(card.id);
    const activeTab = tab === 'mpcfill' && !card.printing ? 'printings' : tab;
    const hasBack = (card.printing !== undefined && faceImageUris(card.printing, 'back') !== undefined) || card.customImage?.back !== undefined || card.mpcfill?.back !== undefined;
    const current = currentCandidate(card, order, face);
    const shown = selected ?? current;
    const reference = shown && referencePrinting(shown, card, face);
    const usable = selected !== undefined && !isCurrent(selected, card, face);
    const changing = Math.min(copies ?? card.quantity, card.quantity);
    const filter = adjustmentFilter(combineAdjustments(order.adjustments, card.adjustments));
    const deckName = order.decks.find(deck => deck.url === card.deck)?.name ?? card.deck;
    const panes = [shown && candidatePane(shown, face), reference && scryfallPane(reference, face)].filter(pane => pane !== undefined);

    function changeCard(change: (card: OrderCard) => OrderCard) {
        update(current => ({ ...current, cards: current.cards.map(c => c.id === card!.id ? change(c) : c) }));
    }

    // Only for cards added in the app: an imported card would come back with the next update from Moxfield.
    function remove() {
        if (!window.confirm(`Remove ${card!.name} from the order?`)) return;
        update(current => ({ ...current, cards: current.cards.filter(c => c.id !== card!.id) }));
        dialog.current?.close();
    }

    function open(next: string | undefined) {
        if (next === undefined) return;
        setId(next);
        setFace('front');
        setSelected(undefined);
        setCopies(undefined);
        setError(undefined);
        dialog.current?.focus();
    }

    function use(candidate: Candidate) {
        if (candidate.type === 'scryfall') {
            let moved = card!.id;
            // The order changes at once, so the entry the copies went to is known right after.
            update(current => {
                const changed = changePrinting(current.cards, card!.id, candidate.printing, changing);
                moved = changed.id;
                return { ...current, cards: changed.cards };
            });
            setId(moved);
            setCopies(undefined);
        } else if (candidate.type === 'mpcfill') {
            changeCard(c => chooseMpcfillImage(c, face, candidate.id, candidate.printing));
        }
        setSelected(undefined);
        dialog.current?.focus();
    }

    async function pickImage(pick: Face) {
        setError(undefined);
        try {
            const file = await api.pickCustomImage();
            if (!file) return;
            changeCard(c => ({ ...c, customImage: pick === 'front' ? { ...c.customImage, front: file } : { front: c.customImage?.front ?? file, back: file } }));
            setFace(pick);
            setSelected(undefined);
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    function chooseTab(next: Tab) {
        setTab(next);
        setSelected(undefined);
    }

    function chooseFace(next: Face) {
        setFace(next);
        setSelected(undefined);
    }

    function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
        const target = event.target as Element;
        if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, select, textarea')) return;
        if (event.key.startsWith('Arrow')) {
            event.preventDefault();
            moveSelection(event.key);
        } else if (event.key === 'Enter' && (target === dialog.current || target.closest('.printing'))) {
            event.preventDefault();
            if (usable) use(selected);
        } else if (event.key.toLowerCase() === 'c' && reference) {
            setComparing(!comparing);
        } else if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            open(ids[index + (event.key === 'PageUp' ? -1 : 1)]);
        }
    }

    function moveSelection(key: string) {
        const tiles = [...candidates.current?.querySelectorAll<HTMLButtonElement>('button.printing:not(:disabled)') ?? []].filter(tile => tile.checkVisibility());
        const from = tiles.find(tile => tile.getAttribute('aria-pressed') === 'true') ?? tiles.find(tile => tile.classList.contains('current'));
        const at = from ? tiles.indexOf(from) : -1;
        const next = !from ? tiles[0]
            : key === 'ArrowLeft' ? tiles[at - 1]
            : key === 'ArrowRight' ? tiles[at + 1]
            : nearestInNextRow(tiles, from, key === 'ArrowUp' ? -1 : 1);
        next?.focus();
        next?.click();
    }

    const toolbar = <>
        {hasBack && (
            <div className="segmented" role="group" aria-label="Face">
                <button aria-pressed={face === 'front'} onClick={() => chooseFace('front')}>Front</button>
                <button aria-pressed={face === 'back'} onClick={() => chooseFace('back')}>Back</button>
            </div>
        )}
        <button aria-pressed={comparing && reference !== undefined} disabled={!reference}
                title={reference ? 'Shows the Scryfall scan next to the image (C)' : shown?.type === 'scryfall' ? 'This is the Scryfall scan of the current printing' : 'The card has no Scryfall printing'}
                onClick={() => setComparing(!comparing)}><Columns2/>Compare with Scryfall</button>
    </>;

    return (
        <dialog ref={dialog} className="card-editor" tabIndex={-1} onClose={onClose} onKeyDown={onKeyDown}>
            <header className="dialog-header">
                <div>
                    <h2>{card.name}</h2>
                    <span className="meta">{count(card.quantity, 'copy', 'copies')} · {describePrinting(card)} · {deckName}, {boardName(card.board)}</span>
                </div>
                <div className="row">
                    {index >= 0 && <span className="meta">Card {index + 1} of {ids.length}</span>}
                    <button className="quiet" aria-label="Previous card" disabled={index <= 0} onClick={() => open(ids[index - 1])}><ChevronLeft/></button>
                    <button className="quiet" aria-label="Next card" disabled={index < 0 || index >= ids.length - 1} onClick={() => open(ids[index + 1])}><ChevronRight/></button>
                    <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
                </div>
            </header>

            <div className="editor-body">
                <section className="editor-stage">
                    {panes.length > 0
                        ? <ImageStage key={`${card.id} ${face}`} panes={comparing ? panes : panes.slice(0, 1)} filter={filter}>{toolbar}</ImageStage>
                        : <div className="stage-column">
                            <div className="row stage-tools">{toolbar}</div>
                            <div className="stage-empty">{face === 'back' ? 'The back is printed with the order\'s card back.' : 'No image. Pick a printing or an own image.'}</div>
                        </div>}

                    <div className="row use-row">
                        <span className="status grow">{explain(selected, current, card, face, changing)}</span>
                        {selected?.type === 'scryfall' && usable && card.quantity > 1 && (
                            <label className="row">
                                <span className="muted">Change</span>
                                <input className="quantity" type="number" min={1} max={card.quantity} value={changing} aria-label="Copies to change"
                                       onChange={e => setCopies(Math.min(card.quantity, Math.max(1, Math.round(Number(e.target.value)) || 1)))}/>
                                <span className="muted">of {card.quantity}</span>
                            </label>
                        )}
                        <button className="primary" disabled={!usable} onClick={() => usable && use(selected)}><Check/>Use this</button>
                    </div>

                    <div className="editor-settings">
                        <div className="row">
                            <label className="row">
                                <span className="muted">Copies</span>
                                <input className="quantity" type="number" min={1} max={99} value={card.quantity}
                                       onChange={e => changeCard(c => ({ ...c, quantity: Math.max(1, Number(e.target.value) || 1) }))}/>
                            </label>
                            <label className="print-toggle">
                                <input type="checkbox" checked={!card.excluded} onChange={e => changeCard(c => ({ ...c, excluded: !e.target.checked }))}/>
                                <span>Print</span>
                            </label>
                            <AdjustmentSliders
                                adjustments={card.adjustments ?? { brightness: 1, contrast: 1 }}
                                onChange={adjustments => changeCard(c => ({ ...c, adjustments }))}
                                onReset={() => changeCard(({ adjustments: _, ...rest }) => rest)}
                                resetLabel="Use the order's values"
                                canReset={card.adjustments !== undefined}/>
                        </div>
                        <div className="row">
                            <span className="status grow">
                                {card.customImage ? 'Printed from your own image.' : card.mpcfill ? 'Printed from the MPC Autofill image picked for this printing.' : card.printing ? 'Printed from the Scryfall scan of this printing.' : 'Not printed, as Scryfall has no printing of this card.'}
                                {' '}Brightness and contrast apply on top of the order's {percent(order.adjustments.brightness)} and {percent(order.adjustments.contrast)}; the preview shows them approximately.
                            </span>
                            {(card.customImage || card.mpcfill) && <button className="quiet danger" onClick={() => changeCard(({ customImage: _, mpcfill: __, ...rest }) => rest)}><Undo2/>Use Scryfall again</button>}
                            {card.deck === '' && <button className="quiet danger" onClick={remove}><Trash2/>Remove from the order</button>}
                        </div>
                    </div>
                </section>

                <section className="editor-candidates">
                    <div className="row">
                        <div className="segmented" role="group" aria-label="Image source">
                            {TABS.map(([value, label]) => (
                                <button key={value} aria-pressed={activeTab === value} disabled={value === 'mpcfill' && !card.printing}
                                        title={value === 'mpcfill' && !card.printing ? 'Pick a printing first; MPC Autofill images are matched against it.' : undefined}
                                        onClick={() => chooseTab(value)}>{label}</button>
                            ))}
                        </div>
                        {activeTab !== 'own' && (
                            <label className="zoom">
                                <span className="muted">Tile size</span>
                                <input type="range" min={TILE_MIN} max={TILE_MAX} step={10} value={tileWidth} onChange={e => setTileWidth(Number(e.target.value))}/>
                            </label>
                        )}
                    </div>

                    <div ref={candidates} className="candidates" style={{ '--tile-width': `${tileWidth}px` } as CSSProperties}>
                        {activeTab === 'printings' && (
                            <PrintingCandidates key={card.name} card={card} face={face} nonfoilOnly={nonfoilOnly}
                                                selected={selected?.type === 'scryfall' ? selected.printing.id : undefined}
                                                onSelect={printing => setSelected({ type: 'scryfall', printing })}
                                                onUse={printing => use({ type: 'scryfall', printing })}/>
                        )}
                        {activeTab === 'mpcfill' && (
                            <MpcfillCandidates key={mpcfillSearchKey(card, face)} card={card} face={face} large={tileWidth > 200}
                                               selected={selected?.type === 'mpcfill' ? selected.id : undefined}
                                               onSelect={(image, printing) => setSelected({ type: 'mpcfill', id: image.identifier, image, printing })}
                                               onUse={(image, printing) => use({ type: 'mpcfill', id: image.identifier, image, printing })}/>
                        )}
                        {activeTab === 'own' && (
                            <div className="own-image">
                                <p className="status">
                                    Your own image is printed instead of the printing's. Images in the page format of 69 × 94 mm already contain the bleed,
                                    card-sized images get a mirrored 3 mm bleed. PNG, JPEG and WebP images work; landscape images are turned down.
                                </p>
                                <div className="row">
                                    <button onClick={() => void pickImage('front')}><ImagePlus/>Choose a front image…</button>
                                    <button onClick={() => void pickImage('back')}><ImageUp/>Choose a back image…</button>
                                </div>
                                {error && <p className="status error">{error}</p>}
                            </div>
                        )}
                    </div>
                    <p className="status">Arrow keys pick an image, Enter uses it, C compares it with the Scryfall scan, Page Up and Page Down go to the previous or next card.</p>
                </section>
            </div>
        </dialog>
    );
}

// The image the face prints from, in the order of the processing.
function currentCandidate(card: OrderCard, order: Order, face: Face): Candidate | undefined {
    const source = cardFaces(card, order)?.[face].source;
    if (source?.type === 'scryfall') return { type: 'scryfall', printing: source.printing };
    if (source?.type === 'mpcfill') return { type: 'mpcfill', id: source.id, image: undefined, printing: card.printing };
    if (source?.type === 'custom') return { type: 'custom', image: source.image };
    return undefined;
}

function isCurrent(candidate: Candidate, card: OrderCard, face: Face) {
    if (candidate.type === 'scryfall') return candidate.printing.id === card.printing?.id;
    if (candidate.type === 'mpcfill') return card.mpcfill?.[face] === candidate.id;
    return true;
}

// The Scryfall scan the image is compared with: the printing it shows, otherwise the card's printing.
function referencePrinting(candidate: Candidate, card: OrderCard, face: Face) {
    const printing = candidate.type === 'mpcfill' ? candidate.printing ?? card.printing : card.printing;
    if (!printing || !faceImageUris(printing, face)) return undefined;
    return candidate.type === 'scryfall' && candidate.printing.id === printing.id ? undefined : printing;
}

function candidatePane(candidate: Candidate, face: Face): Pane | undefined {
    if (candidate.type === 'scryfall') return scryfallPane(candidate.printing, face);
    if (candidate.type === 'custom') return { preview: `preview://image/${encodeURIComponent(candidate.image)}`, bleed: false, caption: 'Your own image, as a 700 px preview' };
    const { id, image } = candidate;
    return {
        preview: mpcfillImage(id, 'large'),
        full: `preview://mpcfill/${encodeURIComponent(id)}`,
        bleed: true,
        caption: image ? `MPC Autofill, ${image.dpi} dpi, by ${image.sourceName}` : 'MPC Autofill image'
    };
}

function scryfallPane(printing: ScryfallCard, face: Face): Pane | undefined {
    const uris = faceImageUris(printing, face);
    if (!uris) return undefined;
    const lowRes = printing.image_status === 'lowres' ? ', low-res' : '';
    return { preview: uris.normal, full: uris.png, bleed: false, caption: `Scryfall scan of ${printing.set.toUpperCase()} #${printing.collector_number}${lowRes}` };
}

// What using the picked image changes besides the image.
function explain(selected: Candidate | undefined, current: Candidate | undefined, card: OrderCard, face: Face, copies: number) {
    if (!selected || isCurrent(selected, card, face)) return current ? 'This is the image the card prints from now. Pick another one on the right to compare it.' : '';
    const ownWins = card.customImage ? ' Your own image is still printed until you use Scryfall again.' : '';
    if (selected.type === 'scryfall') {
        const others = copies < card.quantity ? ` The other ${count(card.quantity - copies, 'copy', 'copies')} keep their printing.` : '';
        const dropped = card.mpcfill ? ' The MPC Autofill image of the old printing is dropped.' : '';
        return `Gives ${copies === card.quantity ? 'the card' : count(copies, 'copy', 'copies')} this printing.${others}${dropped}${ownWins}`;
    }
    if (selected.type === 'mpcfill' && selected.printing && selected.printing.id !== card.printing?.id) {
        return `Also changes the printing of all ${count(card.quantity, 'copy', 'copies')} to ${selected.printing.set.toUpperCase()} #${selected.printing.collector_number}.${ownWins}`;
    }
    return `Prints the ${face} from this MPC Autofill image.${ownWins}`;
}

// The tile in the row above or below that is closest to the column of the tile.
function nearestInNextRow(tiles: HTMLButtonElement[], from: HTMLButtonElement, direction: 1 | -1) {
    const origin = from.getBoundingClientRect();
    const placed = tiles.map(tile => ({ tile, rect: tile.getBoundingClientRect() }))
        .filter(({ rect }) => direction > 0 ? rect.top >= origin.bottom - 1 : rect.bottom <= origin.top + 1);
    if (placed.length === 0) return undefined;
    const tops = placed.map(({ rect }) => rect.top);
    const row = direction > 0 ? Math.min(...tops) : Math.max(...tops);
    return placed.filter(({ rect }) => Math.abs(rect.top - row) < 1)
        .sort((a, b) => Math.abs(a.rect.left - origin.left) - Math.abs(b.rect.left - origin.left))[0]?.tile;
}
