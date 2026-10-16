import { type FormEvent, useState } from "react";
import { Package, Plus, SlidersHorizontal, X } from "lucide-react";
import { isValidOrderName, type Order } from "../../../../src/model.js";
import { buildPacks } from "../../../../src/pipeline/packs.js";
import { errorMessage } from "../api.js";
import { ColorBar, RegistrationMark } from "./Decor.js";
import { Tasks } from "./Tasks.js";
import { UpdateNotice } from "./UpdateNotice.js";

interface Props {
    orders: Order[];
    selected: string | undefined;
    profilesSelected: boolean;
    onSelectOrder(name: string): void;
    onSelectProfiles(): void;
    onCreateOrder(name: string): Promise<void>;
}

export function Rail({ orders, selected, profilesSelected, onSelectOrder, onSelectProfiles, onCreateOrder }: Props) {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState<string>();

    const problem = !isValidOrderName(name)
        ? 'Use a name without \\ / : * ? " < > | and without spaces at the ends.'
        : orders.some(order => order.name === name) ? 'An order with this name exists already.' : undefined;

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
                    <small>Print files for meinspiel.de</small>
                </div>
            </div>
            <ColorBar/>

            <div>
                <h2>Orders</h2>
                <ul className="rail-list">
                    {orders.map(order => (
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
                <button className="rail-item" aria-current={profilesSelected ? 'page' : undefined} onClick={onSelectProfiles}><span className="with-icon"><SlidersHorizontal/>Processing profiles</span></button>
            </div>
        </nav>
    );
}

function describe(order: Order) {
    if (order.cards.length === 0) return 'not imported';
    const packs = buildPacks(order).packs.length;
    return packs === 1 ? '1 pack' : `${packs} packs`;
}
