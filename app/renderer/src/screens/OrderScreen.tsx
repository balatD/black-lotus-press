import { type CSSProperties, type FormEvent, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ArrowRight, ArrowRightLeft, Check, Ellipsis, PencilLine, Share2, Trash, X } from "lucide-react";
import { CARD_SIZES, type Order, type ProcessingProfile, type Shop } from "../../../../src/model.js";
import { SetupTab } from "./SetupTab.js";
import { CardsTab, isNotOnScryfall } from "./CardsTab.js";
import { PrintTab } from "./PrintTab.js";
import { ShopTransfer } from "../components/ShopTransfer.js";
import { OrderExport } from "../components/OrderExport.js";
import { useShortcut } from "../useShortcut.js";
import { useTasks } from "../useTasks.js";
import { orderNameProblem } from "../components/Rail.js";
import { errorMessage } from "../api.js";
import { SHOPS } from "../shops.js";
import { Guide, orderStep } from "../components/Guide.js";

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
    // The tab to open on, instead of the one for the order's state.
    tab?: OrderTab | undefined;
    onEditProfile(name: string): void;
    // The place in the sidebar for the guide, while it is on.
    guide: HTMLElement | undefined;
    onGuideOff(): void;
}

const TABS = ['Setup', 'Cards', 'Print'] as const;
export type OrderTab = (typeof TABS)[number];

export function OrderScreen({ order, orders, profiles, onChange, onFlush, onDelete, onMove, onCopy, onRename, tab: startTab, onEditProfile, guide, onGuideOff }: Props) {
    const [tab, setTab] = useState<OrderTab>(startTab ?? (order.cards.length > 0 ? 'Cards' : 'Setup'));
    const [transferring, setTransferring] = useState(false);
    const [exporting, setExporting] = useState(false);
    // The new name while it is being typed.
    const [renaming, setRenaming] = useState<string>();
    const [renameError, setRenameError] = useState<string>();
    // A task of the order would go on under the old name.
    const tasks = useTasks();
    const busy = tasks.some(task => task.kind !== 'browser');
    const importing = tasks.some(task => task.kind === 'import' && order.decks.some(deck => deck.url === task.deck));
    const nameProblem = renaming === undefined || renaming === order.name ? undefined : orderNameProblem(renaming, orders, order.shop);
    const latest = useRef(order);
    latest.current = order;
    const search = useRef<HTMLInputElement>(null);
    const menu = useRef<HTMLDivElement>(null);

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

    // The menu closes first, as the rename form or a confirmation follows.
    function fromMenu(action: () => void) {
        return () => {
            menu.current?.hidePopover();
            action();
        };
    }

    const imported = order.cards.length > 0;
    // Print is the last step, so it is never ticked.
    const done: Record<OrderTab, boolean> = { Setup: imported, Cards: imported && !order.cards.some(card => !card.excluded && isNotOnScryfall(card)), Print: false };
    const handover = order.shop === 'meinspiel' ? 'upload them to meinspiel.de' : order.shop === 'home' ? 'print them' : `send them to ${SHOPS[order.shop].name}`;
    const next = !imported ? undefined
        : tab === 'Setup' ? { tab: 'Cards' as const, text: 'Next, check the cards and change their images, copies or order where you like.' }
        : tab === 'Cards' ? { tab: 'Print' as const, text: `Next, process the images and ${handover}.` }
        : undefined;

    function confirmDelete() {
        if (window.confirm(`Delete the order "${order.name}"? The processed images stay in the orders folder.`)) onDelete();
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
                <div className="tabs step-tabs" role="tablist">
                    {TABS.map(name => (
                        <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
                            {name}{done[name] && <Check className="step-done" role="img" aria-label="done"/>}
                        </button>
                    ))}
                </div>
                <button className="quiet order-menu-button" style={{ marginLeft: 'auto', marginBottom: '0.75rem' }} popoverTarget="order-menu" aria-label="Order actions" title="Order actions"><Ellipsis/></button>
                <div ref={menu} id="order-menu" popover="auto" className="order-menu">
                    {order.tcg === 'magic' && <button className="quiet" onClick={fromMenu(() => setTransferring(true))}><ArrowRightLeft/>Move or copy</button>}
                    <button className="quiet" onClick={fromMenu(() => setExporting(true))}><Share2/>Export</button>
                    {renaming === undefined && <button className="quiet" disabled={busy} onClick={fromMenu(() => setRenaming(order.name))}><PencilLine/>Rename</button>}
                    <button className="quiet danger" onClick={fromMenu(confirmDelete)}><Trash/>Delete order</button>
                </div>
            </header>
            {/* The card images of the order in the shape of its cards, also in the dialogs opened from here. */}
            <div className="screen-body" style={{ '--card-mm-width': CARD_SIZES[order.tcg].width, '--card-mm-height': CARD_SIZES[order.tcg].height } as CSSProperties}>
                {tab === 'Setup' && <SetupTab order={order} profiles={profiles} update={update} onEditProfile={onEditProfile}/>}
                {tab === 'Cards' && <CardsTab order={order} update={update} search={search} onSetup={() => setTab('Setup')}/>}
                {tab === 'Print' && <PrintTab order={order} update={update} onFlush={onFlush} onSetup={() => setTab('Setup')}/>}
            </div>
            {next && (
                <footer className="next-step">
                    <p>{next.text}</p>
                    <button className="primary" data-guide="next" onClick={() => setTab(next.tab)}>Next: {next.tab}<ArrowRight/></button>
                </footer>
            )}
            {guide && createPortal(<Guide step={orderStep(order, tab, importing)} onOff={onGuideOff}/>, guide)}
            {transferring && <ShopTransfer order={order} orders={orders} onMove={onMove} onCopy={onCopy} onClose={() => setTransferring(false)}/>}
            {exporting && <OrderExport order={order} onClose={() => setExporting(false)}/>}
        </>
    );
}
