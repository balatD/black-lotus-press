import { useEffect, useRef, useState } from "react";
import { FileArchive, Images, X } from "lucide-react";
import type { Order } from "../../../../src/model.js";
import { api, errorMessage } from "../api.js";
import { useTasks } from "../useTasks.js";

interface Props {
    order: Order;
    onClose(): void;
}

export function OrderExport({ order, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState<string>();
    const [error, setError] = useState<string>();
    const task = useTasks().find(task => task.kind !== 'browser' && task.order === order.name);

    useEffect(() => {
        dialog.current?.showModal();
    }, []);

    async function save(withImages: boolean) {
        setBusy(true);
        setSaved(undefined);
        setError(undefined);
        try {
            setSaved(await api.exportOrder(order, withImages));
        } catch (e) {
            setError(errorMessage(e));
        }
        setBusy(false);
    }

    return (
        <dialog ref={dialog} className="review-dialog transfer-dialog" onClose={onClose}>
            <header className="dialog-header">
                <div>
                    <h2>Export {order.name}</h2>
                    <span className="meta">As a file for Black Lotus Press on another computer, with its decks, cards, the images you picked and your edits.</span>
                </div>
                <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
            </header>

            <section className="transfer-option">
                <h3>With the processed images</h3>
                <p className="status">
                    The downloaded and upscaled images come along, so the other app neither downloads nor upscales them again
                    and makes the print files in seconds. The file is large: about 1 MB per card.
                </p>
                <button className="primary" disabled={busy || task !== undefined} onClick={() => void save(true)}><Images/>Export with the images</button>
            </section>

            <section className="transfer-option">
                <h3>Only the order</h3>
                <p className="status">
                    A small file. The other app downloads the images and processes them itself, with Upscayl if this order upscales.
                </p>
                <button disabled={busy || task !== undefined} onClick={() => void save(false)}><FileArchive/>Export only the order</button>
            </section>

            {saved && <p className="status">Saved as {saved}</p>}
            {task && <p className="status warning">{task.title} is still running. Wait for it or cancel it first.</p>}
            {error && <p className="error" role="alert">{error}</p>}
        </dialog>
    );
}
