import { type FormEvent, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { ScryfallCard } from "../../../../src/model.js";
import { faceImageUris } from "../../../../src/pipeline/packs.js";
import { api, errorMessage } from "../api.js";
import { ProgressBar } from "./ProgressBar.js";

interface Props {
    onPick(token: ScryfallCard): void;
    onClose(): void;
}

// Searches only when asked, since every search is a request to Scryfall.
export function TokenPicker({ onPick, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [found, setFound] = useState<{ name: string, tokens: ScryfallCard[] }>();
    const [error, setError] = useState<string>();

    useEffect(() => dialog.current?.showModal(), []);

    async function search(event: FormEvent) {
        event.preventDefault();
        const name = query.trim();
        setSearching(true);
        setError(undefined);
        try {
            setFound({ name, tokens: await api.searchTokens(name) });
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSearching(false);
        }
    }

    function pick(token: ScryfallCard) {
        onPick(token);
        dialog.current?.close();
    }

    return (
        <dialog ref={dialog} className="review-dialog token-dialog" aria-labelledby="token-title" onClose={onClose}>
            <header className="dialog-header">
                <div>
                    <h2 id="token-title">Tokens from Scryfall</h2>
                    <span className="meta">Find a token by name, for example Clue, Food or Soldier, and click it to add it to the order.</span>
                </div>
                <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
            </header>
            <form className="row" onSubmit={search}>
                <input type="search" autoFocus aria-label="Name of the token" placeholder="Name of the token" value={query} onChange={e => setQuery(e.target.value)}/>
                <button className="primary" disabled={searching || query.trim() === ''}><Search/>Search</button>
            </form>
            {error && <p className="error" role="alert">{error}</p>}
            {searching && <ProgressBar progress={undefined} label="Searching Scryfall"/>}
            {found && found.tokens.length === 0 && <p className="status">Scryfall has no token named "{found.name}".</p>}
            <div className="printing-grid">
                {found?.tokens.map(token => (
                    <button key={token.id} className="printing" title={token.name} onClick={() => pick(token)}>
                        <img src={faceImageUris(token, 'front')?.small} alt="" loading="lazy"/>
                        <span className="printing-set">{token.name}</span>
                        <span className="meta">{token.set_name ?? token.set.toUpperCase()}</span>
                    </button>
                ))}
            </div>
        </dialog>
    );
}
