import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { MpcfillCard } from "../../../../src/clients/mpcfill.js";
import { mpcfillImage } from "../../../../src/pipeline/packs.js";
import { api, errorMessage } from "../api.js";
import { ProgressBar } from "./ProgressBar.js";

interface Props {
    current: string;
    onPick(driveId: string): void;
    onClose(): void;
}

export function CardbackPicker({ current, onPick, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [cardbacks, setCardbacks] = useState<MpcfillCard[]>();
    const [error, setError] = useState<string>();
    const [query, setQuery] = useState('');
    // MPC Autofill still lists a few card backs whose images are gone from Google Drive; their previews fail as well.
    const [gone, setGone] = useState(new Set<string>());

    useEffect(() => {
        dialog.current?.showModal();
        let closed = false;
        api.listCardbacks().then(found => !closed && setCardbacks(found), e => !closed && setError(errorMessage(e)));
        return () => {
            closed = true;
        };
    }, []);

    const words = query.toLowerCase().split(/\s+/).filter(word => word !== '');
    const shown = (cardbacks ?? []).filter(cardback => words.every(word => `${cardback.name} ${cardback.sourceName}`.toLowerCase().includes(word)));

    function pick(cardback: MpcfillCard) {
        onPick(cardback.identifier);
        dialog.current?.close();
    }

    return (
        <dialog ref={dialog} className="review-dialog cardback-dialog" onClose={onClose}>
            <header className="dialog-header">
                <div>
                    <h2>Card backs from MPC Autofill</h2>
                    <span className="meta">
                        {cardbacks ? `${shown.length} of ${cardbacks.length} card backs. ` : ''}Click one to print it on every card without its own back.
                    </span>
                </div>
                <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
            </header>
            <input type="search" autoFocus placeholder="Find a card back by name or creator" value={query} onChange={e => setQuery(e.target.value)}/>
            {error && <p className="error" role="alert">{error}</p>}
            {!cardbacks && !error && <ProgressBar progress={undefined} label="Loading the card backs of MPC Autofill"/>}
            {cardbacks && shown.length === 0 && <p className="status">No card back matches "{query}".</p>}
            <div className="printing-grid">
                {shown.map(cardback => (
                    <button key={cardback.identifier} className={`printing${cardback.identifier === current ? ' current' : ''}`} title={cardback.name}
                            disabled={gone.has(cardback.identifier)} onClick={() => pick(cardback)}>
                        {gone.has(cardback.identifier)
                            ? <span className="thumb unavailable">Not available</span>
                            : <img src={mpcfillImage(cardback.identifier, 'small')} alt="" loading="lazy"
                                   onError={() => setGone(missing => new Set(missing).add(cardback.identifier))}/>}
                        {cardback.identifier === current && <span className="printing-current">Current card back</span>}
                        <span className="printing-set">{cardback.name}</span>
                        <span className="meta">{cardback.sourceName}</span>
                        <span className="badges"><span className="badge">{cardback.dpi} dpi</span></span>
                    </button>
                ))}
            </div>
        </dialog>
    );
}
