import { useEffect, useState } from "react";
import { type OrderCard, type TcgCard, tcgCardKey } from "../../../../src/model.js";
import { api, errorMessage } from "../api.js";
import { tcgPreview } from "../shops.js";
import { ProgressBar } from "./ProgressBar.js";

interface Props {
    card: OrderCard & { tcgCard: TcgCard };
    selected: string | undefined;
    onSelect(card: TcgCard): void;
    onUse(card: TcgCard): void;
}

const searches = new Map<string, Promise<TcgCard[]>>();

// Searched once per card while the app runs; a failed search is tried again next time.
function candidatesOf({ name, tcgCard }: Props['card']): Promise<TcgCard[]> {
    const language = tcgCard.tcg === 'pokemon' ? tcgCard.lang : 'en';
    const key = `${tcgCard.tcg} ${language} ${name}`;
    let search = searches.get(key);
    if (!search) {
        search = api.searchTcgCards(tcgCard.tcg, name, language);
        search.catch(() => searches.delete(key));
        searches.set(key, search);
    }
    return search;
}

// The other artworks of a Yu-Gi-Oh card from YGOPRODeck, or the printings of a Pokémon card from TCGdex, the current one first.
export function TcgCandidates({ card, selected, onSelect, onUse }: Props) {
    const [found, setFound] = useState<TcgCard[]>();
    const [error, setError] = useState<string>();
    const yugioh = card.tcgCard.tcg === 'yugioh';
    const current = tcgCardKey(card.tcgCard);

    useEffect(() => {
        let cancelled = false;
        candidatesOf(card).then(result => !cancelled && setFound(result), e => !cancelled && setError(errorMessage(e)));
        return () => {
            cancelled = true;
        };
    }, [card.name, current]);

    const others = (found ?? []).filter(candidate => tcgCardKey(candidate) !== current);
    return (
        <>
            {error && <p className="error">{error}</p>}
            {!found && !error && <ProgressBar progress={undefined} label={yugioh ? 'Searching YGOPRODeck for the artworks' : 'Searching TCGdex for the printings'}/>}
            {found && <p className="status">{others.length === 0 ? `No other ${yugioh ? 'artwork' : 'printing'} found.` : `${others.length} other ${yugioh ? 'artworks' : 'printings'}.`}</p>}
            <div className="printing-grid">
                {[card.tcgCard, ...others].map(candidate => {
                    const key = tcgCardKey(candidate);
                    return (
                        <button key={key} className={`printing${key === current ? ' current' : ''}`} aria-pressed={selected === key} onClick={() => onSelect(candidate)} onDoubleClick={() => onUse(candidate)}>
                            <img src={tcgPreview(candidate, !yugioh)} alt="" loading="lazy"/>
                            {key === current && <span className="printing-current">{yugioh ? 'Current artwork' : 'Current printing'}</span>}
                            <span className="meta">{yugioh ? `Artwork ${candidate.id}` : candidate.id}</span>
                        </button>
                    );
                })}
            </div>
        </>
    );
}
