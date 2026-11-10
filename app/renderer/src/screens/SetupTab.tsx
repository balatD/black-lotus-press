import { useEffect, useRef, useState } from "react";
import { CircleStop, Download, Images, Layers, Plus, RectangleVertical, RefreshCw, SlidersHorizontal, Trash } from "lucide-react";
import { type DeckConfig, DeckData, deckSite, isArchidektDeckUrl, isDeckUrl, type Order, type OrderCard, POKEMON_LANGUAGES, type ProcessingProfile, replaceDeckCards, type Tcg, updateDeckCards, withDecks } from "../../../../src/model.js";
import type { Task } from "../../../shared/api.js";
import { api, errorMessage, wasStopped } from "../api.js";
import { useProgress } from "../useProgress.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { useTasks } from "../useTasks.js";
import { PrintingReview } from "../components/PrintingReview.js";
import { count, describeCopyright, describeProcessing } from "../format.js";
import { CardbackPicker } from "../components/CardbackPicker.js";

interface Props {
    order: Order;
    profiles: ProcessingProfile[];
    update(change: (order: Order) => Order): void;
    onEditProfile(name: string): void;
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

const YGO_BOARDS: [DeckData, string][] = [[DeckData.MainBoard, 'Main deck'], [DeckData.Extra, 'Extra deck'], [DeckData.SideBoard, 'Side deck']];

const NEW_DECK_BOARDS = [DeckData.MainBoard, DeckData.SideBoard, DeckData.Tokens];
const ARCHIDEKT_BOARDS = [DeckData.MainBoard, DeckData.SideBoard, DeckData.Tokens, DeckData.Considering];

export function SetupTab({ order, profiles, update, onEditProfile }: Props) {
    const onChange = (changed: Order) => update(() => changed);
    const savedProfile = profiles.find(profile => profile.name === order.profile.name);
    const profileChanged = savedProfile !== undefined && JSON.stringify(savedProfile) !== JSON.stringify(order.profile);
    const running = useTasks().find(task => task.kind !== 'browser');
    // The deck whose freshly imported printings are up for review.
    const [review, setReview] = useState<string>();
    // A deck added while no task runs is imported right away.
    const [fresh, setFresh] = useState<string>();

    function setDecks(decks: DeckConfig[]) {
        onChange(withDecks(order, decks));
    }

    function addDeck(deck: DeckConfig) {
        setDecks([...order.decks, deck]);
        if (!running) setFresh(deck.url);
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
                <h2><Layers/>{order.tcg === 'magic' ? 'Decks' : 'Deck lists'}</h2>
                <p className="muted">
                    {order.tcg === 'magic' ? order.decks.length === 0
                            ? 'Paste the link of a Moxfield deck that is public or unlisted, or of an Archidekt deck visible without logging in, tick the boards to print and click Add and import.'
                            : 'Update brings the deck\'s changes from Moxfield or Archidekt and keeps your edits. Changing the address or the boards of a deck removes its cards, so it gets imported again.'
                        : order.tcg === 'yugioh' ? 'Paste a .ydk file or a ydke:// link, as EDOPro, Dueling Nexus and YGOPRODeck export decks. The cards come from YGOPRODeck in the artwork the list names.'
                        : 'Paste the deck list Pokémon TCG Live or Limitless exports, with lines like "4 Charizard ex OBF 125". The cards come from TCGdex.'}
                    {order.tcg !== 'magic' && ' Update brings the changes of the list and keeps your edits.'}
                </p>
                {order.tcg === 'pokemon' && (
                    <div className="field">
                        <label htmlFor="card-language">Card language</label>
                        <select id="card-language" value={order.language ?? 'en'} onChange={e => onChange({ ...order, language: e.target.value })}>
                            {POKEMON_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                        </select>
                        <p className="hint">The language of the card images. Update the lists to switch their cards; cards without an image in the language print in English.</p>
                    </div>
                )}
                {order.decks.map((deck, index) => (
                    <DeckRow
                        key={deck.url}
                        deck={deck}
                        order={order}
                        running={running}
                        importNow={deck.url === fresh}
                        onImported={(name, cards) => imported(deck.url, name, cards)}
                        onUpdated={(name, cards) => updated(deck.url, name, cards)}
                        cardCount={order.cards.filter(card => card.deck === deck.url).reduce((total, card) => total + card.quantity, 0)}
                        onChange={changed => setDecks(order.decks.map((d, i) => i === index ? changed : d))}
                        onRemove={() => setDecks(order.decks.filter((_, i) => i !== index))}
                    />
                ))}
                {order.tcg === 'magic'
                    ? <NewDeck existing={order.decks} running={running !== undefined} onAdd={(url, data) => addDeck({ url, data })}/>
                    : <NewDeckList tcg={order.tcg} running={running !== undefined} onAdd={(list, data) => addDeck(newDeckList(order, list, data))}/>}
            </section>

            {order.tcg === 'magic' && <CardBack driveId={order.cardBack} onChange={cardBack => onChange({ ...order, cardBack })}/>}

            <section>
                <h2><SlidersHorizontal/>Profile</h2>
                <div className="field">
                    <label htmlFor="profile">Processing profile</label>
                    <div className="row">
                        <select id="profile" className="grow" value={order.profile.name} onChange={e => applyProfile(e.target.value)}>
                            {!savedProfile && <option value={order.profile.name}>{order.profile.name} (deleted)</option>}
                            {profiles.map(profile => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
                        </select>
                        <button disabled={!savedProfile} onClick={() => onEditProfile(order.profile.name)}><SlidersHorizontal/>Edit profile</button>
                    </div>
                    <p className="hint">
                        {describeProcessing(order.profile)}, {describeCopyright(order.profile.postProcessing)}. Another profile or changed settings process all images of this order again.
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

            {review && <PrintingReview order={order} deckUrl={review} update={update} onClose={() => setReview(undefined)}/>}
        </div>
    );
}

// The url of a pasted list is an id, which the cards and tasks of the list refer to like to a deck's address.
function newDeckList(order: Order, list: string, data: DeckData[]): DeckConfig {
    return { url: `list:${crypto.randomUUID()}`, data, name: `Deck list ${order.decks.length + 1}`, list };
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
    importNow: boolean;
    cardCount: number;
    onChange(deck: DeckConfig): void;
    onImported(name: string, cards: OrderCard[]): void;
    onUpdated(name: string, cards: OrderCard[]): { added: number, removed: number, changed: number };
    onRemove(): void;
}

function DeckRow({ deck, order, running, importNow, cardCount, onChange, onImported, onUpdated, onRemove }: DeckRowProps) {
    const [url, setUrl] = useState(deck.url);
    const [list, setList] = useState(deck.list ?? '');
    const [error, setError] = useState<string>();
    const [result, setResult] = useState<string>();
    const [notes, setNotes] = useState<string[]>([]);
    const importing = running?.kind === 'import' && running.deck === deck.url ? running : undefined;
    const progress = useProgress(importing !== undefined);
    const isList = deck.list !== undefined;
    const valid = isList ? list.trim() !== '' : isDeckUrl(url);
    const site = isList ? 'the list' : deckSite(deck.url);
    const archidekt = isArchidektDeckUrl(deck.url);
    // StrictMode runs the effect twice in development, which would start a second import.
    const started = useRef(false);

    async function load(apply: (name: string, cards: OrderCard[]) => void) {
        setError(undefined);
        setResult(undefined);
        setNotes([]);
        try {
            if (isList) {
                const { cards, notes } = await api.importDeckList({ ...deck, list }, order.tcg, order.language ?? 'en');
                setNotes(notes);
                apply(deck.name ?? 'Deck list', cards);
                return;
            }
            const { name, cards } = await api.importDeck(deck, order.profile.playwrightChannel);
            apply(name, cards);
        } catch (e) {
            if (!wasStopped(e)) setError(errorMessage(e));
        }
    }

    useEffect(() => {
        if (!importNow || started.current) return;
        started.current = true;
        void load(onImported);
    }, []);

    function importDeck() {
        if (cardCount > 0 && !window.confirm(`Import ${deck.name ?? 'this deck'} again? Your changes to its cards are lost.`)) return;
        void load(onImported);
    }

    function updateDeck() {
        void load((name, cards) => {
            const { added, removed, changed } = onUpdated(name, cards);
            setResult(added + removed + changed === 0
                ? `Already up to date with ${site}.`
                : `Updated from ${site}: ${count(added, 'card')} added, ${count(removed, 'card')} removed, ${count(changed, 'card')} changed. Your edits were kept.`);
        });
    }

    function commitUrl() {
        if (valid && url !== deck.url) onChange({ url, data: deck.data });
    }

    // A changed list keeps its cards until it is imported or updated again.
    function commitList() {
        if (list !== deck.list) onChange({ ...deck, list });
    }

    function remove() {
        if (cardCount === 0 || window.confirm(`Remove ${deck.name ?? 'this deck'} and its ${cardCount} cards from the order?`)) onRemove();
    }

    return (
        <div className="deck" data-guide={importing ? 'importing' : undefined}>
            <div className="row">
                <span className="name grow">{deck.name ?? 'Not imported yet'}</span>
                <span className="muted">{cardCount > 0 ? `${cardCount} cards` : ''}</span>
                {cardCount > 0 && <button disabled={running !== undefined} onClick={updateDeck}><RefreshCw/>Update</button>}
                <button className={cardCount > 0 ? 'quiet' : 'primary'} disabled={running !== undefined} onClick={importDeck}><Download/>{cardCount > 0 ? 'Import again' : 'Import'}</button>
                {importing
                    ? <button className="quiet" onClick={() => void api.stopTask(importing.id)}><CircleStop/>Cancel</button>
                    : <button className="quiet danger" onClick={remove}><Trash/>Remove</button>}
            </div>
            {importing && <ProgressBar progress={progress} label={isList ? `Looking up the cards on ${order.tcg === 'yugioh' ? 'YGOPRODeck' : 'TCGdex'}` : archidekt ? 'Loading the deck from Archidekt' : 'Loading the deck from Moxfield in a browser window'}/>}
            {error && <span className="status error">{error}</span>}
            {result && <span className="status">{result}</span>}
            {notes.map(note => <span key={note} className="warning">{note}</span>)}
            {isList
                ? <textarea className="deck-list" aria-label={`List of ${deck.name ?? 'the deck'}`} value={list} aria-invalid={!valid} spellCheck={false} rows={4}
                            onChange={e => setList(e.target.value)} onBlur={commitList}/>
                : <input value={url} aria-invalid={!valid} spellCheck={false}
                         onChange={e => setUrl(e.target.value)} onBlur={commitUrl} onKeyDown={e => e.key === 'Enter' && commitUrl()}/>}
            <Boards boards={boardsOf(order.tcg, deck.url)} data={deck.data} onChange={data => onChange({ ...deck, data })}/>
        </div>
    );
}

function boardsOf(tcg: Tcg, url: string): [DeckData, string][] {
    return tcg === 'yugioh' ? YGO_BOARDS : tcg === 'pokemon' ? [] : BOARDS.filter(([board]) => !isArchidektDeckUrl(url) || ARCHIDEKT_BOARDS.includes(board));
}

function Boards({ boards, data, onChange }: { boards: [DeckData, string][], data: DeckData[], onChange(data: DeckData[]): void }) {
    function toggle(board: DeckData) {
        const changed = data.includes(board) ? data.filter(b => b !== board) : [...data, board];
        if (changed.length > 0) onChange(changed);
    }

    return (
        <div className="boards">
            {boards.map(([board, label]) => (
                <label key={board}>
                    <input type="checkbox" checked={data.includes(board)} onChange={() => toggle(board)}/>
                    <span>{label}</span>
                </label>
            ))}
        </div>
    );
}

// The boards come first: the deck imports right away, and changing its boards later removes its cards.
function NewDeck({ existing, running, onAdd }: { existing: DeckConfig[], running: boolean, onAdd(url: string, data: DeckData[]): void }) {
    const [url, setUrl] = useState('');
    const [data, setData] = useState(NEW_DECK_BOARDS);
    const duplicate = existing.some(deck => deck.url === url);
    const boards = boardsOf('magic', url);
    // An Archidekt deck lacks some of the boards of a Moxfield deck.
    const chosen = data.filter(board => boards.some(([offered]) => offered === board));
    const valid = isDeckUrl(url) && !duplicate && chosen.length > 0;

    function add() {
        if (!valid) return;
        onAdd(url, chosen);
        setUrl('');
    }

    return (
        <div className="new-deck" data-guide="deck">
            <div className="row">
                <input className="grow" placeholder="https://moxfield.com/decks/… or https://archidekt.com/decks/…" value={url} spellCheck={false}
                       aria-invalid={url !== '' && !valid} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}/>
                <button className={existing.length === 0 ? 'primary' : ''} disabled={!valid} onClick={add}><Plus/>{running ? 'Add deck' : 'Add and import'}</button>
                {duplicate && <span className="status error">This deck is already in the order.</span>}
            </div>
            {isDeckUrl(url) && <Boards boards={boards} data={chosen} onChange={setData}/>}
        </div>
    );
}

function NewDeckList({ tcg, running, onAdd }: { tcg: Tcg, running: boolean, onAdd(list: string, data: DeckData[]): void }) {
    const [list, setList] = useState('');
    const boards = boardsOf(tcg, '');
    const [data, setData] = useState(boards.length > 0 ? boards.map(([board]) => board) : [DeckData.MainBoard]);

    function add() {
        if (list.trim() === '') return;
        onAdd(list, data);
        setList('');
    }

    return (
        <div className="new-deck" data-guide="deck">
            <div className="row" style={{ alignItems: 'flex-start' }}>
                <textarea className="grow deck-list" aria-label="New deck list" placeholder="Paste a deck list" value={list} spellCheck={false} rows={4} onChange={e => setList(e.target.value)}/>
                <button className={list.trim() !== '' ? 'primary' : ''} disabled={list.trim() === ''} onClick={add}><Plus/>{running ? 'Add deck list' : 'Add and import'}</button>
            </div>
            {boards.length > 0 && <Boards boards={boards} data={data} onChange={setData}/>}
        </div>
    );
}
