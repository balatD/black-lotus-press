import { useEffect, useState } from "react";
import { CircleStop, Download, Images, Layers, Plus, RectangleVertical, RefreshCw, SlidersHorizontal, Trash } from "lucide-react";
import { type DeckConfig, DeckData, isMoxfieldDeckUrl, type Order, type OrderCard, type ProcessingProfile, replaceDeckCards, updateDeckCards, withDecks } from "../../../../src/model.js";
import type { Task } from "../../../shared/api.js";
import { api, errorMessage, wasStopped } from "../api.js";
import { useProgress } from "../useProgress.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { useTasks } from "../useTasks.js";
import { PrintingReview } from "../components/PrintingReview.js";
import { count, describeProcessing } from "../format.js";
import { CardbackPicker } from "../components/CardbackPicker.js";

interface Props {
    order: Order;
    profiles: ProcessingProfile[];
    update(change: (order: Order) => Order): void;
}

const BOARDS: [DeckData, string][] = [
    [DeckData.MainBoard, 'Main board'],
    [DeckData.SideBoard, 'Sideboard'],
    [DeckData.Tokens, 'Tokens'],
    [DeckData.Considering, 'Considering'],
    [DeckData.Attractions, 'Attractions'],
    [DeckData.Contraptions, 'Contraptions'],
    [DeckData.Stickers, 'Stickers'],
    [DeckData.Planes, 'Planar deck'],
    [DeckData.Schemes, 'Schemes']
];

const NEW_DECK_BOARDS = [DeckData.MainBoard, DeckData.SideBoard, DeckData.Tokens];

export function SetupTab({ order, profiles, update }: Props) {
    const onChange = (changed: Order) => update(() => changed);
    const savedProfile = profiles.find(profile => profile.name === order.profile.name);
    const profileChanged = savedProfile !== undefined && JSON.stringify(savedProfile) !== JSON.stringify(order.profile);
    const running = useTasks().find(task => task.kind !== 'browser');
    // The deck whose freshly imported printings are up for review.
    const [review, setReview] = useState<string>();

    function setDecks(decks: DeckConfig[]) {
        onChange(withDecks(order, decks));
    }

    function imported(url: string, name: string, cards: OrderCard[]) {
        update(current => ({
            ...current,
            decks: current.decks.map(deck => deck.url === url ? { ...deck, name } : deck),
            cards: replaceDeckCards(current.cards, url, cards)
        }));
        if (cards.some(card => card.foil)) setReview(url);
    }

    function updated(url: string, name: string, cards: OrderCard[]) {
        let changes = { added: 0, removed: 0, changed: 0 };
        update(current => {
            const result = updateDeckCards(current.cards, url, cards);
            changes = result;
            return { ...current, decks: current.decks.map(deck => deck.url === url ? { ...deck, name } : deck), cards: result.cards };
        });
        return changes;
    }

    function applyProfile(name: string) {
        const profile = profiles.find(p => p.name === name);
        if (profile) onChange({ ...order, profile });
    }

    return (
        <div className="form">
            <section>
                <h2><SlidersHorizontal/>Profile</h2>
                <div className="field">
                    <label htmlFor="profile">Processing profile</label>
                    <select id="profile" value={order.profile.name} onChange={e => applyProfile(e.target.value)}>
                        {!savedProfile && <option value={order.profile.name}>{order.profile.name} (deleted)</option>}
                        {profiles.map(profile => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
                    </select>
                    <p className="hint">
                        {describeProcessing(order.profile)}. Another profile or changed settings process all images of this order again.
                    </p>
                </div>
                {profileChanged && (
                    <div className="field">
                        <span/>
                        <div className="row">
                            <span className="warning">The profile "{order.profile.name}" was changed since this order took it over.</span>
                            <button onClick={() => applyProfile(order.profile.name)}><RefreshCw/>Use the changed profile</button>
                        </div>
                    </div>
                )}
            </section>

            <CardBack driveId={order.cardBack} onChange={cardBack => onChange({ ...order, cardBack })}/>

            <section>
                <h2><Layers/>Decks</h2>
                <p className="muted">Update brings the deck's changes from Moxfield and keeps your edits. Changing the address or the boards of a deck removes its cards, so it gets imported again.</p>
                {order.decks.map((deck, index) => (
                    <DeckRow
                        key={deck.url}
                        deck={deck}
                        order={order}
                        running={running}
                        onImported={(name, cards) => imported(deck.url, name, cards)}
                        onUpdated={(name, cards) => updated(deck.url, name, cards)}
                        cardCount={order.cards.filter(card => card.deck === deck.url).reduce((total, card) => total + card.quantity, 0)}
                        onChange={changed => setDecks(order.decks.map((d, i) => i === index ? changed : d))}
                        onRemove={() => setDecks(order.decks.filter((_, i) => i !== index))}
                    />
                ))}
                <NewDeck existing={order.decks} onAdd={url => setDecks([...order.decks, { url, data: NEW_DECK_BOARDS }])}/>
            </section>
            {review && <PrintingReview order={order} deckUrl={review} update={update} onClose={() => setReview(undefined)}/>}
        </div>
    );
}

function CardBack({ driveId, onChange }: { driveId: string, onChange(driveId: string): void }) {
    const [preview, setPreview] = useState<{ src?: string, error?: string }>({});
    const [choosing, setChoosing] = useState(false);

    useEffect(() => {
        setPreview({});
        if (!driveId) return;

        let cancelled = false;
        const timer = window.setTimeout(() => {
            api.previewCardBack(driveId)
                .then(src => !cancelled && setPreview({ src }))
                .catch(e => !cancelled && setPreview({ error: errorMessage(e) }));
        }, 500);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [driveId]);

    return (
        <section>
            <h2><RectangleVertical/>Card back</h2>
            <div className="row" style={{ alignItems: 'flex-start', gap: '1.5rem' }}>
                <div className="proof">
                    {preview.src
                        ? <img src={preview.src} alt="Card back"/>
                        : <div className="placeholder">{preview.error ? 'No image' : driveId ? <ProgressBar progress={undefined} label="Loading"/> : 'No card back'}</div>}
                </div>
                <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label htmlFor="card-back" className="muted">MPC Autofill card back ID</label>
                    <input id="card-back" value={driveId} spellCheck={false} onChange={e => onChange(e.target.value.trim())}/>
                    {preview.error
                        ? <span className="status error">{preview.error}</span>
                        : <span className="status">The Google Drive ID of a card back from the MPC Autofill database. It is printed on every card without its own back.</span>}
                    <div className="row">
                        <button onClick={() => setChoosing(true)}><Images/>Choose from MPC Autofill</button>
                    </div>
                </div>
            </div>
            {choosing && <CardbackPicker current={driveId} onPick={onChange} onClose={() => setChoosing(false)}/>}
        </section>
    );
}

interface DeckRowProps {
    deck: DeckConfig;
    order: Order;
    running: Task | undefined;
    cardCount: number;
    onChange(deck: DeckConfig): void;
    onImported(name: string, cards: OrderCard[]): void;
    onUpdated(name: string, cards: OrderCard[]): { added: number, removed: number, changed: number };
    onRemove(): void;
}

function DeckRow({ deck, order, running, cardCount, onChange, onImported, onUpdated, onRemove }: DeckRowProps) {
    const [url, setUrl] = useState(deck.url);
    const [error, setError] = useState<string>();
    const [result, setResult] = useState<string>();
    const importing = running?.kind === 'import' && running.deck === deck.url ? running : undefined;
    const progress = useProgress(importing !== undefined);
    const valid = isMoxfieldDeckUrl(url);

    async function load(apply: (name: string, cards: OrderCard[]) => void) {
        setError(undefined);
        setResult(undefined);
        try {
            const { name, cards } = await api.importDeck(deck, order.profile.playwrightChannel);
            apply(name, cards);
        } catch (e) {
            if (!wasStopped(e)) setError(errorMessage(e));
        }
    }

    function importDeck() {
        if (cardCount > 0 && !window.confirm(`Import ${deck.name ?? 'this deck'} again? Your changes to its cards are lost.`)) return;
        void load(onImported);
    }

    function updateDeck() {
        void load((name, cards) => {
            const { added, removed, changed } = onUpdated(name, cards);
            setResult(added + removed + changed === 0
                ? 'Already up to date with Moxfield.'
                : `Updated from Moxfield: ${count(added, 'card')} added, ${count(removed, 'card')} removed, ${count(changed, 'card')} changed. Your edits were kept.`);
        });
    }

    function commitUrl() {
        if (valid && url !== deck.url) onChange({ url, data: deck.data });
    }

    function toggle(board: DeckData) {
        const data = deck.data.includes(board) ? deck.data.filter(b => b !== board) : [...deck.data, board];
        if (data.length > 0) onChange({ ...deck, data });
    }

    function remove() {
        if (cardCount === 0 || window.confirm(`Remove ${deck.name ?? 'this deck'} and its ${cardCount} cards from the order?`)) onRemove();
    }

    return (
        <div className="deck">
            <div className="row">
                <span className="name grow">{deck.name ?? 'Not imported yet'}</span>
                <span className="muted">{cardCount > 0 ? `${cardCount} cards` : ''}</span>
                {cardCount > 0 && <button disabled={running !== undefined} onClick={updateDeck}><RefreshCw/>Update</button>}
                <button className={cardCount > 0 ? 'quiet' : 'primary'} disabled={running !== undefined} onClick={importDeck}><Download/>{cardCount > 0 ? 'Import again' : 'Import'}</button>
                {importing
                    ? <button className="quiet" onClick={() => void api.stopTask(importing.id)}><CircleStop/>Cancel</button>
                    : <button className="quiet danger" onClick={remove}><Trash/>Remove</button>}
            </div>
            {importing && <ProgressBar progress={progress} label="Loading the deck from Moxfield in a browser window"/>}
            {error && <span className="status error">{error}</span>}
            {result && <span className="status">{result}</span>}
            <input value={url} aria-invalid={!valid} spellCheck={false}
                   onChange={e => setUrl(e.target.value)} onBlur={commitUrl} onKeyDown={e => e.key === 'Enter' && commitUrl()}/>
            <div className="boards">
                {BOARDS.map(([board, label]) => (
                    <label key={board}>
                        <input type="checkbox" checked={deck.data.includes(board)} onChange={() => toggle(board)}/>
                        <span>{label}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

function NewDeck({ existing, onAdd }: { existing: DeckConfig[], onAdd(url: string): void }) {
    const [url, setUrl] = useState('');
    const duplicate = existing.some(deck => deck.url === url);
    const valid = isMoxfieldDeckUrl(url) && !duplicate;

    function add() {
        if (!valid) return;
        onAdd(url);
        setUrl('');
    }

    return (
        <div className="row">
            <input className="grow" placeholder="https://moxfield.com/decks/…" value={url} spellCheck={false}
                   aria-invalid={url !== '' && !valid} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}/>
            <button disabled={!valid} onClick={add}><Plus/>Add deck</button>
            {duplicate && <span className="status error">This deck is already in the order.</span>}
        </div>
    );
}
