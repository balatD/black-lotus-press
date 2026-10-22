import { useCallback, useEffect, useRef, useState } from "react";
import { DefaultOrder, type Order, type ProcessingProfile, type Shop } from "../../../src/model.js";
import { api, errorMessage } from "./api.js";
import { Rail } from "./components/Rail.js";
import { OrderScreen } from "./screens/OrderScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { RegistrationMark } from "./components/Decor.js";
import { Splash } from "./components/Splash.js";
import { ShopPicker } from "./components/ShopPicker.js";
import { SHOPS } from "./shops.js";

type View = { type: 'order', name: string } | { type: 'profiles' } | { type: 'none' };

const SAVE_DELAY_MS = 600;

export function App() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [profiles, setProfiles] = useState<ProcessingProfile[]>([]);
    const [view, setView] = useState<View>({ type: 'none' });
    const [error, setError] = useState<string>();
    const [splash, setSplash] = useState(true);
    const endSplash = useCallback(() => setSplash(false), []);
    // Asked on every start, after the splash.
    const [shop, setShop] = useState<Shop>();
    const pendingSaves = useRef(new Map<string, { order: Order, timer: number }>());

    const reload = useCallback(async () => {
        const [loadedOrders, loadedProfiles] = await Promise.all([api.listOrders(), api.listProfiles()]);
        setOrders(loadedOrders.orders);
        setProfiles(loadedProfiles.profiles);
        const unreadable = [...loadedOrders.unreadable, ...loadedProfiles.unreadable];
        if (unreadable.length > 0) setError(`Left out the files that could not be read, which stay as they are: ${unreadable.join(', ')}`);
    }, []);

    useEffect(() => {
        reload().catch(e => setError(errorMessage(e)));
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

    async function createOrder(name: string) {
        const order: Order = { ...DefaultOrder, name, shop: shop!, profile: profiles[0] ?? DefaultOrder.profile };
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

    async function show(next: View) {
        await flushSaves();
        setView(next);
    }

    async function switchShop() {
        await show({ type: 'none' });
        setShop(undefined);
    }

    const order = view.type === 'order' ? orders.find(o => o.name === view.name) : undefined;

    return (
        <>
        {splash && <Splash onDone={endSplash}/>}
        {!splash && !shop && <ShopPicker onPick={setShop}/>}
        <div className={`app ${splash || !shop ? 'waiting' : 'revealed'}`}>
            <Rail
                orders={orders}
                shop={shop}
                onSwitchShop={() => void switchShop()}
                selected={view.type === 'order' ? view.name : undefined}
                profilesSelected={view.type === 'profiles'}
                onSelectOrder={name => void show({ type: 'order', name })}
                onSelectProfiles={() => void show({ type: 'profiles' })}
                onCreateOrder={createOrder}
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
                    />
                )}
                {view.type === 'profiles' && <ProfilesScreen profiles={profiles} onSaved={reload}/>}
                {view.type === 'none' && (
                    <div className="empty">
                        <RegistrationMark size={72} className="empty-mark"/>
                        <h1>Pick an order on the left</h1>
                        <p>Or create a new one to turn Moxfield decks into print files for {shop && SHOPS[shop].name}.</p>
                    </div>
                )}
            </main>
        </div>
        </>
    );
}
