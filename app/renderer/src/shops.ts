import type { Shop, TcgCard } from "../../../src/model.js";
import meinspielLogo from "./assets/meinspiel.png";
import notmpcLogo from "./assets/notmpc.png";
import printerstudioLogo from "./assets/printerstudio.png";
import homeLogo from "./assets/home.svg";

// A shop that is not available cannot be chosen; its orders stay as they are until it is available again.
export const SHOPS: Record<Shop, { name: string, logo: string, offer: string, available: boolean }> = {
    meinspiel: { name: 'meinspiel.de', logo: meinspielLogo, offer: 'RGB images in packs of 55 cards, uploaded to your account', available: true },
    notmpc: { name: 'notmpc.eu', logo: notmpcLogo, offer: 'RGB images in decks of up to 612 cards, filled into their designer', available: false },
    printerstudio: { name: 'printerstudio.de', logo: printerstudioLogo, offer: 'RGB images in decks of up to 612 cards on Standard stock, filled into their designer', available: true },
    home: { name: 'Home printer', logo: homeLogo, offer: 'A PDF of the card fronts on A4 or Letter pages with cut guides, for your own printer', available: true }
};

// Yu-Gi-Oh and Pokémon images go through the app's cache, as YGOPRODeck asks for its images not to be loaded from its server every time.
export function tcgPreview(card: TcgCard, small = false) {
    const url = !small ? card.image : card.tcg === 'pokemon' ? card.image.replace(/\/high\.png$/, '/low.png') : card.image.replace('/images/cards/', '/images/cards_small/');
    return `preview://tcg/image?url=${encodeURIComponent(url)}`;
}
