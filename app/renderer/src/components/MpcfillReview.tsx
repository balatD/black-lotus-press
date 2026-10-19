import { useEffect, useRef, useState } from "react";
import { Check, Images } from "lucide-react";
import type { Order, OrderCard } from "../../../../src/model.js";
import { faceImageUris, mpcfillImage } from "../../../../src/pipeline/packs.js";
import { describePrinting } from "../format.js";
import { CardEditor } from "./CardEditor.js";

interface Props {
    order: Order;
    update(change: (order: Order) => Order): void;
    onClose(): void;
}

// A printed face that still comes from the Scryfall scan; own images are left alone.
export function lacksMpcfill(card: OrderCard) {
    if (card.excluded || !card.printing || card.customImage) return false;
    return !card.mpcfill?.front || (faceImageUris(card.printing, 'back') !== undefined && !card.mpcfill.back);
}

// The cards without an MPC Autofill image, each picked by hand; an image of another printing gives the card that printing.
export function MpcfillReview({ order, update, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [choosing, setChoosing] = useState<OrderCard>();
    // The cards when the dialog opened, so a card stays in the list once it has its image.
    const [ids] = useState(() => new Set(order.cards.filter(lacksMpcfill).map(card => card.id)));

    useEffect(() => {
        dialog.current?.showModal();
        dialog.current?.focus();
    }, []);

    const cards = order.cards.filter(card => ids.has(card.id));
    const open = cards.filter(lacksMpcfill).length;

    return (
        // React passes the close event of the card editor inside on to this one.
        <dialog ref={dialog} className="review-dialog" tabIndex={-1} onClose={event => event.target === event.currentTarget && onClose()}>
            <header className="dialog-header">
                <div>
                    <h2>Cards without an MPC Autofill image</h2>
                    <span className="meta">
                        MPC Autofill has no image of the printing of {cards.length === 1 ? 'this card' : `these ${cards.length} cards`}.
                        Pick an image of another printing for each; the card takes that printing. {open === 0 ? 'All of them come from MPC Autofill now.' : `${open} still print from the Scryfall scan.`}
                    </span>
                </div>
                <button className="primary" onClick={() => dialog.current?.close()}><Check/>Done</button>
            </header>
            <ul className="review-list">
                {cards.map(card => {
                    const image = card.mpcfill?.front ? mpcfillImage(card.mpcfill.front, 'small') : card.printing && faceImageUris(card.printing, 'front')?.small;
                    return (
                        <li key={card.id} className="review-row">
                            {image ? <img className="thumb" src={image} alt="" loading="lazy"/> : <span className="thumb missing"/>}
                            <span className="card-name">
                                <span className="name">{card.quantity > 1 ? `${card.quantity}× ` : ''}{card.name}</span>
                                <span className="meta">{describePrinting(card)}</span>
                            </span>
                            {lacksMpcfill(card) ? <span className="badge warning">Scryfall scan</span> : <span className="badge own">MPC Autofill</span>}
                            <span className="meta"/>
                            <button onClick={() => setChoosing(card)}><Images/>Choose image…</button>
                        </li>
                    );
                })}
            </ul>
            {choosing && <CardEditor order={order} update={update} ids={cards.map(card => card.id)} start={choosing.id} tab="mpcfill"
                                     face={choosing.mpcfill?.front ? 'back' : 'front'} onClose={() => setChoosing(undefined)}/>}
        </dialog>
    );
}
