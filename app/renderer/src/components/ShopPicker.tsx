import { useState } from "react";
import type { Shop } from "../../../../src/model.js";
import { SHOPS } from "../shops.js";

export function ShopPicker({ defaultShop, onPick }: { defaultShop: Shop | null, onPick(shop: Shop, asDefault: boolean): void }) {
    const [asDefault, setAsDefault] = useState(defaultShop !== null);

    return (
        <div className="shop-picker">
            <h1>Where do you want to print?</h1>
            <div className="shops">
                {(Object.keys(SHOPS) as Shop[]).map(shop => (
                    <button key={shop} className="shop" disabled={!SHOPS[shop].available} onClick={() => onPick(shop, asDefault)}>
                        <span className="proof"><span className="shop-logo"><img src={SHOPS[shop].logo} alt={SHOPS[shop].name}/></span></span>
                        <span className="meta">{SHOPS[shop].available ? SHOPS[shop].offer : 'Not available at the moment'}</span>
                    </button>
                ))}
            </div>
            <label className="default-shop">
                <input type="checkbox" checked={asDefault} onChange={e => setAsDefault(e.target.checked)}/>
                <span>Always start with the shop I pick</span>
            </label>
            <p className="status">Every order belongs to the shop it was made for. You can switch shops in the sidebar.</p>
        </div>
    );
}
