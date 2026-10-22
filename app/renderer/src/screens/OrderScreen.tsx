import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowRightLeft, Check, GalleryVerticalEnd, type LucideIcon, PencilLine, Printer, Settings2, Trash, X } from "lucide-react";
import type { Order, ProcessingProfile, Shop } from "../../../../src/model.js";
import { SetupTab } from "./SetupTab.js";
import { CardsTab } from "./CardsTab.js";
import { type BuiltPdfs, PrintTab } from "./PrintTab.js";
import { ShopTransfer } from "../components/ShopTransfer.js";
import { useShortcut } from "../useShortcut.js";
import { useTasks } from "../useTasks.js";
import { orderNameProblem } from "../components/Rail.js";
import { errorMessage } from "../api.js";

interface Props {
    order: Order;
    // The orders of every shop.
    orders: Order[];
    profiles: ProcessingProfile[];
    onChange(order: Order): void;
    onFlush(): Promise<void>;
    onDelete(): void;
    onMove(shop: Shop): Promise<void>;
    onCopy(shop: Shop, name: string): Promise<void>;
    onRename(name: string): Promise<void>;
}

const TABS = ['Setup', 'Cards', 'Print'] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, LucideIcon> = { Setup: Settings2, Cards: GalleryVerticalEnd, Print: Printer };

export function OrderScreen({ order, orders, profiles, onChange, onFlush, onDelete, onMove, onCopy, onRename }: Props) {
    const [tab, setTab] = useState<Tab>(order.cards.length > 0 ? 'Cards' : 'Setup');
    // Kept here, so the built PDFs survive switching tabs.
    const [pdfs, setPdfs] = useState<BuiltPdfs>();
    const [transferring, setTransferring] = useState(false);
    // The new name while it is being typed.
    const [renaming, setRenaming] = useState<string>();
    const [renameError, setRenameError] = useState<string>();
    // A task of the order would go on under the old name.
    const busy = useTasks().some(task => task.kind !== 'browser');
    const nameProblem = renaming === undefined || renaming === order.name ? undefined : orderNameProblem(renaming, orders, order.shop);
    const latest = useRef(order);
    latest.current = order;
    const search = useRef<HTMLInputElement>(null);

    useShortcut('1', () => setTab('Setup'));
    useShortcut('2', () => setTab('Cards'));
    useShortcut('3', () => setTab('Print'));
    // The Cards tab has to be on screen before its search can take the focus.
    useShortcut('f', () => {
        flushSync(() => setTab('Cards'));
        search.current?.focus();
    });

    // Changes apply to the latest order, so results of long jobs do not overwrite edits made meanwhile.
    function update(change: (order: Order) => Order) {
        latest.current = change(latest.current);
        onChange(latest.current);
    }

    async function rename(event: FormEvent) {
        event.preventDefault();
        try {
            await onRename(renaming!);
        } catch (e) {
            setRenameError(errorMessage(e));
        }
    }

    function confirmDelete() {
        if (window.confirm(`Delete the order "${order.name}"? The processed images and PDFs stay in the orders folder.`)) onDelete();
    }

    return (
        <>
            <header className="screen-header">
                {renaming === undefined ? <h1>{order.name}</h1> : (
                    <form className="rename-form" onSubmit={rename}>
                        <input autoFocus aria-label="New name of the order" value={renaming} aria-invalid={nameProblem !== undefined}
                               onChange={e => { setRenaming(e.target.value); setRenameError(undefined); }}/>
                        <button type="submit" className="primary" disabled={nameProblem !== undefined || renaming === order.name || busy}><Check/>Rename</button>
                        <button type="button" className="quiet" onClick={() => setRenaming(undefined)}><X/>Cancel</button>
                        {(nameProblem ?? renameError) && <span className="status error">{nameProblem ?? renameError}</span>}
                    </form>
                )}
                <div className="tabs" role="tablist">
                    {TABS.map(name => {
                        const Icon = TAB_ICONS[name];
                        return <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}><Icon/>{name}</button>;
                    })}
                </div>
                <button className="quiet" style={{ marginLeft: 'auto', marginBottom: '0.75rem' }} onClick={() => setTransferring(true)}><ArrowRightLeft/>Move or copy</button>
                {renaming === undefined && <button className="quiet" style={{ marginBottom: '0.75rem' }} disabled={busy} onClick={() => setRenaming(order.name)}><PencilLine/>Rename</button>}
                <button className="quiet danger" style={{ marginBottom: '0.75rem' }} onClick={confirmDelete}><Trash/>Delete order</button>
            </header>
            <div className="screen-body">
                {tab === 'Setup' && <SetupTab order={order} profiles={profiles} update={update}/>}
                {tab === 'Cards' && <CardsTab order={order} update={update} search={search}/>}
                {tab === 'Print' && <PrintTab order={order} update={update} onFlush={onFlush} built={pdfs} onBuilt={setPdfs}/>}
            </div>
            {transferring && <ShopTransfer order={order} orders={orders} onMove={onMove} onCopy={onCopy} onClose={() => setTransferring(false)}/>}
        </>
    );
}
