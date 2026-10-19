import { useEffect, useRef, useState } from "react";
import { Check, Replace } from "lucide-react";
import type { Order, OrderCard } from "../../../../src/model.js";
import { faceImageUris } from "../../../../src/pipeline/packs.js";
import { printingPrice } from "../../../../src/printings.js";
import { describePrinting, formatPrice } from "../format.js";
import { CardEditor } from "./CardEditor.js";

interface Props {
    order: Order;
    deckUrl: string;
    update(change: (order: Order) => Order): void;
    onClose(): void;
}

// After an import: the cards Moxfield has as foil keep their printing or get a non-foil one.
export function PrintingReview({ order, deckUrl, update, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [choosing, setChoosing] = useState<OrderCard>();

    useEffect(() => {
        dialog.current?.showModal();
        dialog.current?.focus();
    }, []);

    const deck = order.decks.find(candidate => candidate.url === deckUrl);
    // The foils and their printing when the dialog opened, so a changed card stays in the list.
    const [foils] = useState(() => new Map(order.cards
        .filter(card => card.deck === deckUrl && card.foil && card.printing)
        .map(card => [card.id, card.printing?.id])));
    const cards = order.cards.filter(card => foils.has(card.id));
    const changed = (card: OrderCard) => card.printing?.id !== foils.get(card.id);

    return (
        // React passes the close event of the card editor inside on to this one.
        <dialog ref={dialog} className="review-dialog" tabIndex={-1} onClose={event => event.target === event.currentTarget && onClose()}>
            <header className="dialog-header">
                <div>
                    <h2>Foils in {deck?.name ?? 'the deck'}</h2>
                    <span className="meta">Moxfield has {cards.length === 1 ? 'this card' : `these ${cards.length} cards`} as foil. Keep the foil printings, or pick a non-foil printing for any of them.</span>
                </div>
                <button className="primary" onClick={() => dialog.current?.close()}><Check/>{cards.some(changed) ? 'Done' : 'Keep the foils'}</button>
            </header>
            <ul className="review-list">
                {cards.map(card => {
                    const image = card.printing && faceImageUris(card.printing, 'front')?.small;
                    const price = card.printing && printingPrice(card.printing);
                    return (
                        <li key={card.id} className="review-row">
                            {image ? <img className="thumb" src={image} alt="" loading="lazy"/> : <span className="thumb missing"/>}
                            <span className="card-name">
                                <span className="name">{card.quantity > 1 ? `${card.quantity}× ` : ''}{card.name}</span>
                                <span className="meta">{describePrinting(card)}</span>
                            </span>
                            {changed(card) ? <span className="badge own">Non-foil</span> : <span className="badge warning">Foil</span>}
                            <span className="meta">{price ? formatPrice(price.amount, price.currency) : ''}</span>
                            <button onClick={() => setChoosing(card)}><Replace/>Non-foil printing…</button>
                        </li>
                    );
                })}
            </ul>
            {choosing && <CardEditor order={order} update={update} ids={cards.map(card => card.id)} start={choosing.id} tab="printings" nonfoilOnly onClose={() => setChoosing(undefined)}/>}
        </dialog>
    );
}
