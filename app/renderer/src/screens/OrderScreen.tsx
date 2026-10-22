import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowRightLeft, GalleryVerticalEnd, type LucideIcon, Printer, Settings2, Trash } from "lucide-react";
import type { Order, ProcessingProfile, Shop } from "../../../../src/model.js";
import { SetupTab } from "./SetupTab.js";
import { CardsTab } from "./CardsTab.js";
import { type BuiltPdfs, PrintTab } from "./PrintTab.js";
import { ShopTransfer } from "../components/ShopTransfer.js";
import { useShortcut } from "../useShortcut.js";

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
}

const TABS = ['Setup', 'Cards', 'Print'] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, LucideIcon> = { Setup: Settings2, Cards: GalleryVerticalEnd, Print: Printer };

export function OrderScreen({ order, orders, profiles, onChange, onFlush, onDelete, onMove, onCopy }: Props) {
    const [tab, setTab] = useState<Tab>(order.cards.length > 0 ? 'Cards' : 'Setup');
    // Kept here, so the built PDFs survive switching tabs.
    const [pdfs, setPdfs] = useState<BuiltPdfs>();
    const [transferring, setTransferring] = useState(false);
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

    function confirmDelete() {
        if (window.confirm(`Delete the order "${order.name}"? The processed images and PDFs stay in the orders folder.`)) onDelete();
    }

    return (
        <>
            <header className="screen-header">
                <h1>{order.name}</h1>
                <div className="tabs" role="tablist">
                    {TABS.map(name => {
                        const Icon = TAB_ICONS[name];
                        return <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}><Icon/>{name}</button>;
                    })}
                </div>
                <button className="quiet" style={{ marginLeft: 'auto', marginBottom: '0.75rem' }} onClick={() => setTransferring(true)}><ArrowRightLeft/>Move or copy</button>
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
