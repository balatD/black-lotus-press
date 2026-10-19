import type { Shop } from "../../../../src/model.js";
import { SHOPS } from "../shops.js";

export function ShopPicker({ onPick }: { onPick(shop: Shop): void }) {
    return (
        <div className="shop-picker">
            <h1>Where do you want to print?</h1>
            <div className="shops">
                {(Object.keys(SHOPS) as Shop[]).map(shop => (
                    <button key={shop} className="shop" onClick={() => onPick(shop)}>
                        <span className="proof"><span className="shop-logo"><img src={SHOPS[shop].logo} alt={SHOPS[shop].name}/></span></span>
                        <span className="meta">{SHOPS[shop].offer}</span>
                    </button>
                ))}
            </div>
            <p className="status">Every order belongs to the shop it was made for. You can switch shops in the sidebar.</p>
        </div>
    );
}
