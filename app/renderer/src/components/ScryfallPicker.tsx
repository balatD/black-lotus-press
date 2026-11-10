import { type FormEvent, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { ScryfallCard } from "../../../../src/model.js";
import { faceImageUris } from "../../../../src/pipeline/packs.js";
import { api, errorMessage } from "../api.js";
import { ProgressBar } from "./ProgressBar.js";

interface Props {
    kind: 'card' | 'token';
    onPick(card: ScryfallCard): void;
    onClose(): void;
}

const KINDS = {
    card: {
        title: 'Cards from Scryfall',
        hint: 'Find a card by name, and click it to add it to the order. Its printing and MPC Autofill image are chosen next, in the card editor.',
        search: (name: string) => api.searchCards(name)
    },
    token: {
        title: 'Tokens from Scryfall',
        hint: 'Find a token by name, for example Clue, Food or Soldier, and click it to add it to the order.',
        search: (name: string) => api.searchTokens(name)
    }
};

// Searches only when asked, since every search is a request to Scryfall.
export function ScryfallPicker({ kind, onPick, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [found, setFound] = useState<{ name: string, cards: ScryfallCard[] }>();
    const [error, setError] = useState<string>();

    useEffect(() => dialog.current?.showModal(), []);

    async function search(event: FormEvent) {
        event.preventDefault();
        const name = query.trim();
        setSearching(true);
        setError(undefined);
        try {
            setFound({ name, cards: await KINDS[kind].search(name) });
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSearching(false);
        }
    }

    function pick(card: ScryfallCard) {
        onPick(card);
        dialog.current?.close();
    }

    return (
        <dialog ref={dialog} className="review-dialog scryfall-dialog" aria-labelledby="scryfall-title" onClose={onClose}>
            <header className="dialog-header">
                <div>
                    <h2 id="scryfall-title">{KINDS[kind].title}</h2>
                    <span className="meta">{KINDS[kind].hint}</span>
                </div>
                <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
            </header>
            <form className="row" onSubmit={search}>
                <input type="search" autoFocus aria-label={`Name of the ${kind}`} placeholder={`Name of the ${kind}`} value={query} onChange={e => setQuery(e.target.value)}/>
                <button className="primary" disabled={searching || query.trim() === ''}><Search/>Search</button>
            </form>
            {error && <p className="error" role="alert">{error}</p>}
            {searching && <ProgressBar progress={undefined} label="Searching Scryfall"/>}
            {found && found.cards.length === 0 && <p className="status">Scryfall has no {kind} named "{found.name}".</p>}
            <div className="printing-grid">
                {found?.cards.map(card => (
                    <button key={card.id} className="printing" title={card.name} onClick={() => pick(card)}>
                        <img src={faceImageUris(card, 'front')?.small} alt="" loading="lazy"/>
                        <span className="printing-set">{card.name}</span>
                        <span className="meta">{card.set_name ?? card.set.toUpperCase()}</span>
                    </button>
                ))}
            </div>
        </dialog>
    );
}
