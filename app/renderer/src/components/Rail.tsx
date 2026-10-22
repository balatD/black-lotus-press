import { type FormEvent, useState } from "react";
import { Package, Plus, Search, SlidersHorizontal, Store, X } from "lucide-react";
import { isValidOrderName, type Order, type Shop } from "../../../../src/model.js";
import { buildPacks } from "../../../../src/pipeline/packs.js";
import { errorMessage } from "../api.js";
import { ColorBar, RegistrationMark } from "./Decor.js";
import { Tasks } from "./Tasks.js";
import { UpdateNotice } from "./UpdateNotice.js";
import { SHOPS } from "../shops.js";

interface Props {
    // The orders of every shop; the list shows those of the chosen shop.
    orders: Order[];
    shop: Shop | undefined;
    onSwitchShop(): void;
    selected: string | undefined;
    profilesSelected: boolean;
    onSelectOrder(name: string): void;
    onSelectProfiles(): void;
    onCreateOrder(name: string): Promise<void>;
}

export function Rail({ orders, shop, onSwitchShop, selected, profilesSelected, onSelectOrder, onSelectProfiles, onCreateOrder }: Props) {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState<string>();
    const [query, setQuery] = useState('');

    const problem = orderNameProblem(name, orders, shop);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (problem) return;
        try {
            await onCreateOrder(name);
            setCreating(false);
            setName('');
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    return (
        <nav className="rail">
            <div className="brand">
                <RegistrationMark size={26}/>
                <div>
                    Black Lotus Press
                    <small>Print files for {shop && SHOPS[shop].name}</small>
                </div>
            </div>
            <ColorBar/>

            <div>
                <h2>Orders</h2>
                <label className="search rail-search">
                    <Search/>
                    <input type="search" placeholder="Find an order" value={query} onChange={e => setQuery(e.target.value)}/>
                </label>
                <ul className="rail-list">
                    {orders.filter(order => order.shop === shop && order.name.toLowerCase().includes(query.trim().toLowerCase())).map(order => (
                        <li key={order.name}>
                            <button className="rail-item" aria-current={order.name === selected ? 'page' : undefined} onClick={() => onSelectOrder(order.name)}>
                                <span className="with-icon"><Package/>{order.name}</span>
                                <span className="meta">{describe(order)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>

            {creating ? (
                <form onSubmit={submit}>
                    <input autoFocus placeholder="Order name" value={name} aria-invalid={name !== '' && !!problem} onChange={e => setName(e.target.value)}/>
                    {name !== '' && problem && <span className="status error">{problem}</span>}
                    {error && <span className="status error">{error}</span>}
                    <div className="row">
                        <button type="submit" className="primary" disabled={!!problem}><Plus/>Create order</button>
                        <button type="button" className="quiet" onClick={() => setCreating(false)}><X/>Cancel</button>
                    </div>
                </form>
            ) : (
                <button className="quiet" onClick={() => setCreating(true)}><Plus/>New order</button>
            )}

            <Tasks/>

            <div className="footer">
                <UpdateNotice/>
                <button className="rail-item" onClick={onSwitchShop}><span className="with-icon"><Store/>Switch print shop</span></button>
                <button className="rail-item" aria-current={profilesSelected ? 'page' : undefined} onClick={onSelectProfiles}><span className="with-icon"><SlidersHorizontal/>Processing profiles</span></button>
            </div>
        </nav>
    );
}

// Orders of every shop share one folder, so a name must be free in all of them.
export function orderNameProblem(name: string, orders: Order[], shop: Shop | undefined) {
    const taken = orders.find(order => order.name === name);
    return !isValidOrderName(name)
        ? 'Use a name without \\ / : * ? " < > | and without spaces at the ends.'
        : taken ? `An order with this name exists already${taken.shop === shop ? '' : ` for ${SHOPS[taken.shop].name}`}.` : undefined;
}

function describe(order: Order) {
    if (order.cards.length === 0) return 'not imported';
    const packs = buildPacks(order).packs.length;
    const unit = order.shop === 'meinspiel' ? 'pack' : 'deck';
    return packs === 1 ? `1 ${unit}` : `${packs} ${unit}s`;
}
