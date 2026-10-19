import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Copy, X } from "lucide-react";
import type { Order, Shop } from "../../../../src/model.js";
import { errorMessage } from "../api.js";
import { useTasks } from "../useTasks.js";
import { SHOPS } from "../shops.js";
import { orderNameProblem } from "./Rail.js";

interface Props {
    order: Order;
    // The orders of every shop, which the name of the copy must not take.
    orders: Order[];
    onMove(shop: Shop): Promise<void>;
    onCopy(shop: Shop, name: string): Promise<void>;
    onClose(): void;
}

export function ShopTransfer({ order, orders, onMove, onCopy, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const others = (Object.keys(SHOPS) as Shop[]).filter(shop => shop !== order.shop && SHOPS[shop].available);
    const [shop, setShop] = useState(others[0]!);
    // Until a name is typed, the copy is named after its shop.
    const [typed, setTyped] = useState<string>();
    const name = typed ?? `${order.name} ${SHOPS[shop].name}`;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const task = useTasks().find(task => task.kind !== 'browser' && task.order === order.name);
    const problem = orderNameProblem(name, orders, shop);
    const from = SHOPS[order.shop].name;
    const to = SHOPS[shop].name;

    useEffect(() => {
        dialog.current?.showModal();
    }, []);

    async function run(work: () => Promise<void>) {
        setBusy(true);
        setError(undefined);
        try {
            await work();
            dialog.current?.close();
        } catch (e) {
            setError(errorMessage(e));
            setBusy(false);
        }
    }

    return (
        <dialog ref={dialog} className="review-dialog transfer-dialog" onClose={onClose}>
            <header className="dialog-header">
                <div>
                    <h2>Move or copy {order.name}</h2>
                    <span className="meta">To another print shop, with its decks, cards, the images you picked and your edits.</span>
                </div>
                <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
            </header>

            <div className="chips" role="group" aria-label="Print shop">
                {others.map(other => (
                    <button key={other} className="chip" aria-pressed={other === shop} onClick={() => setShop(other)}>{SHOPS[other].name}</button>
                ))}
            </div>

            <section className="transfer-option">
                <h3>Move</h3>
                <p className="status">
                    The order leaves {from} and keeps its name. Its images are made again in the format of {to}; that only takes seconds,
                    because the downloaded and upscaled images are kept.
                </p>
                <button className="primary" disabled={busy || task !== undefined} onClick={() => void run(() => onMove(shop))}><ArrowRightLeft/>Move to {to}</button>
            </section>

            <section className="transfer-option">
                <h3>Copy</h3>
                <p className="status">The order stays at {from}, and a copy goes to {to}. The downloaded and upscaled images are copied along, so nothing is upscaled again.</p>
                <label htmlFor="copy-name" className="muted">Name of the copy</label>
                <input id="copy-name" value={name} spellCheck={false} aria-invalid={!!problem} onChange={e => setTyped(e.target.value)}/>
                {problem && <span className="status error">{problem}</span>}
                <button disabled={busy || task !== undefined || !!problem} onClick={() => void run(() => onCopy(shop, name))}><Copy/>Copy to {to}</button>
            </section>

            {task && <p className="status warning">{task.title} is still running. Wait for it or cancel it first.</p>}
            {error && <p className="error" role="alert">{error}</p>}
        </dialog>
    );
}
