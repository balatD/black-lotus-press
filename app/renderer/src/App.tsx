import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { DefaultOrder, type Order, type ProcessingProfile, type Shop, type Tcg } from "../../../src/model.js";
import { api, errorMessage } from "./api.js";
import { Rail } from "./components/Rail.js";
import { OrderScreen, type OrderTab } from "./screens/OrderScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { RegistrationMark } from "./components/Decor.js";
import { Splash } from "./components/Splash.js";
import { Guide, startStep } from "./components/Guide.js";
import { ShopPicker } from "./components/ShopPicker.js";
import { SHOPS } from "./shops.js";
import { useStoredState } from "./useStoredState.js";

// A profile opened from the setup of an order leads back there.
type View = { type: 'order', name: string, tab?: OrderTab } | { type: 'profiles', name?: string, from?: string } | { type: 'none' };

const SAVE_DELAY_MS = 600;

export function App() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [profiles, setProfiles] = useState<ProcessingProfile[]>([]);
    const [view, setView] = useState<View>({ type: 'none' });
    const [error, setError] = useState<string>();
    const [splash, setSplash] = useState(true);
    const endSplash = useCallback(() => setSplash(false), []);
    const [defaultShop, setDefaultShop] = useStoredState<Shop | null>('default-shop', null);
    // Asked on every start, after the splash, unless a default shop was chosen.
    const [shop, setShop] = useState<Shop | undefined>(defaultShop ?? undefined);
    // The form for a new order in the sidebar, which the empty screen opens as well.
    const [creating, setCreating] = useState(false);
    // Decided when the orders first load: the guide is for a first order, so it starts on only when there are none.
    const [guide, setGuide] = useStoredState<boolean | null>('guide', null);
    // The place for the guide in the sidebar, which the order screen fills as well.
    const [guideSlot, setGuideSlot] = useState<HTMLDivElement | null>(null);
    const pendingSaves = useRef(new Map<string, { order: Order, timer: number }>());
    // Whether the profile on screen has changes that are not saved, which leaving the screen would drop.
    const unsavedProfile = useRef(false);

    const reload = useCallback(async () => {
        const [loadedOrders, loadedProfiles] = await Promise.all([api.listOrders(), api.listProfiles()]);
        setOrders(loadedOrders.orders);
        setProfiles(loadedProfiles.profiles);
        const unreadable = [...loadedOrders.unreadable, ...loadedProfiles.unreadable];
        if (unreadable.length > 0) setError(`Left out the files that could not be read, which stay as they are: ${unreadable.join(', ')}`);
        return loadedOrders.orders;
    }, []);

    useEffect(() => {
        reload().then(loaded => guide === null && setGuide(loaded.length === 0)).catch(e => setError(errorMessage(e)));
    }, [reload]);

    const save = useCallback(async (order: Order) => {
        pendingSaves.current.delete(order.name);
        try {
            await api.saveOrder(order);
        } catch (e) {
            setError(errorMessage(e));
        }
    }, []);

    // Edits are saved shortly after the last change, so typing does not write the file on every key.
    const updateOrder = useCallback((order: Order) => {
        setOrders(current => current.map(existing => existing.name === order.name ? order : existing));
        const pending = pendingSaves.current.get(order.name);
        if (pending) window.clearTimeout(pending.timer);
        pendingSaves.current.set(order.name, { order, timer: window.setTimeout(() => void save(order), SAVE_DELAY_MS) });
    }, [save]);

    const flushSaves = useCallback(async () => {
        const pending = [...pendingSaves.current.values()];
        pending.forEach(({ timer }) => window.clearTimeout(timer));
        await Promise.all(pending.map(({ order }) => save(order)));
    }, [save]);

    // Holding back the close also holds back quitting the app; once saved, the window closes and the app quits.
    useEffect(() => {
        function beforeUnload(event: BeforeUnloadEvent) {
            if (pendingSaves.current.size === 0) return;
            event.returnValue = false;
            void flushSaves().then(() => window.close());
        }
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [flushSaves]);

    function mayLeave(next?: View) {
        if (view.type !== 'profiles' || next?.type === 'profiles' || !unsavedProfile.current) return true;
        return window.confirm('Leave the processing profile without saving your changes?');
    }

    async function createOrder(name: string, tcg: Tcg) {
        if (!mayLeave()) return;
        const order: Order = { ...DefaultOrder, name, shop: shop!, tcg, profile: profiles[0] ?? DefaultOrder.profile };
        await api.saveOrder(order);
        await reload();
        setView({ type: 'order', name });
    }

    async function deleteOrder(order: Order) {
        await flushSaves();
        await api.deleteOrder(order);
        await reload();
        setView({ type: 'none' });
    }

    // Afterwards the app goes to the order's new shop, where it opens.
    async function sendToShop(order: Order, target: Shop, copyName?: string) {
        await flushSaves();
        if (copyName === undefined) {
            await api.moveOrder(order, target);
        } else {
            await api.copyOrder(order, target, copyName);
        }
        await reload();
        setShop(target);
        setView({ type: 'order', name: copyName ?? order.name });
    }

    // Afterwards the app goes to the order's shop, where it opens.
    async function importOrder() {
        if (!mayLeave()) return;
        await flushSaves();
        const order = await api.importOrder();
        if (!order) return;
        await reload();
        setShop(order.shop);
        setView({ type: 'order', name: order.name });
    }

    // Saved first, so a pending save does not write the order under its old name again.
    async function renameOrder(order: Order, name: string) {
        await flushSaves();
        await api.renameOrder(order, name);
        await reload();
        setView({ type: 'order', name });
    }

    // False when the profile on screen has unsaved changes and the answer was to stay.
    async function show(next: View) {
        if (!mayLeave(next)) return false;
        await flushSaves();
        setView(next);
        return true;
    }

    // Saved first, so a pending save does not write an order with the old name of the profile again.
    async function renameProfile(from: string, profile: ProcessingProfile) {
        await flushSaves();
        await api.renameProfile(from, profile);
        await reload();
    }

    function pickShop(picked: Shop, asDefault: boolean) {
        setDefaultShop(asDefault ? picked : null);
        setShop(picked);
    }

    async function switchShop() {
        if (await show({ type: 'none' })) setShop(undefined);
    }

    const order = view.type === 'order' ? orders.find(o => o.name === view.name) : undefined;

    return (
        <>
        {splash && <Splash onDone={endSplash}/>}
        {!splash && !shop && <ShopPicker defaultShop={defaultShop} onPick={pickShop}/>}
        <div className={`app ${splash || !shop ? 'waiting' : 'revealed'}`}>
            <Rail
                orders={orders}
                shop={shop}
                onSwitchShop={() => void switchShop()}
                creating={creating}
                onCreating={setCreating}
                guide={guide === true}
                onShowGuide={() => setGuide(true)}
                guideSlot={setGuideSlot}
                selected={view.type === 'order' ? view.name : undefined}
                profilesSelected={view.type === 'profiles'}
                onSelectOrder={name => void show({ type: 'order', name })}
                onSelectProfiles={() => void show({ type: 'profiles' })}
                onCreateOrder={createOrder}
                onImportOrder={() => void importOrder().catch(e => setError(errorMessage(e)))}
            />
            <main className="content">
                {error && <p className="error" role="alert" style={{ padding: '0.75rem 1.75rem' }}>{error}</p>}
                {order && (
                    <OrderScreen
                        key={order.name}
                        order={order}
                        orders={orders}
                        profiles={profiles}
                        onChange={updateOrder}
                        onFlush={flushSaves}
                        onDelete={() => void deleteOrder(order).catch(e => setError(errorMessage(e)))}
                        onMove={shop => sendToShop(order, shop)}
                        onCopy={(shop, name) => sendToShop(order, shop, name)}
                        onRename={name => renameOrder(order, name)}
                        tab={view.type === 'order' ? view.tab : undefined}
                        onEditProfile={name => void show({ type: 'profiles', name, from: order.name })}
                        guide={guide === true ? guideSlot ?? undefined : undefined}
                        onGuideOff={() => setGuide(false)}
                    />
                )}
                {view.type === 'none' && guide === true && guideSlot && createPortal(<Guide step={startStep(creating)} onOff={() => setGuide(false)}/>, guideSlot)}
                {view.type === 'profiles' && (
                    <ProfilesScreen
                        profiles={profiles}
                        orders={orders}
                        start={view.name}
                        from={view.from}
                        onBack={() => view.from !== undefined && void show({ type: 'order', name: view.from, tab: 'Setup' })}
                        onSaved={async () => void await reload()}
                        onRename={renameProfile}
                        onUpdateOrders={changed => changed.forEach(updateOrder)}
                        onUnsaved={unsaved => unsavedProfile.current = unsaved}
                    />
                )}
                {view.type === 'none' && (
                    <div className="empty">
                        <RegistrationMark size={72} className="empty-mark"/>
                        {orders.some(o => o.shop === shop) ? <>
                            <h1>Pick an order on the left</h1>
                            <p>Or create a new one to turn Moxfield and Archidekt decks into print files for {shop && SHOPS[shop].name}.</p>
                        </> : <>
                            <h1>Start your first order</h1>
                            <p>An order holds the decks you print together. Give it a name, add the decks, and the app takes you step by step to the print files for {shop && SHOPS[shop].name}.</p>
                            <button className="primary" data-guide="create" onClick={() => setCreating(true)}><Plus/>Create your first order</button>
                        </>}
                    </div>
                )}
            </main>
        </div>
        </>
    );
}
