import type { Shop, TcgCard } from "../../../src/model.js";
import meinspielLogo from "./assets/meinspiel.png";
import printerstudioLogo from "./assets/printerstudio.png";
import homeLogo from "./assets/home.svg";

export const SHOPS: Record<Shop, { name: string, logo: string, offer: string }> = {
    meinspiel: { name: 'meinspiel.de', logo: meinspielLogo, offer: 'RGB images in packs of 55 cards, uploaded to your account' },
    printerstudio: { name: 'printerstudio.de', logo: printerstudioLogo, offer: 'RGB images in decks of up to 612 cards on Standard stock, filled into their designer' },
    home: { name: 'Home printer', logo: homeLogo, offer: 'A PDF of the card fronts on A4 or Letter pages with cut guides, for your own printer' }
};

// The images go through the app's cache, as YGOPRODeck asks for its images not to be loaded from its server every time.
// optcgapi.com has one size only.
export function tcgPreview(card: TcgCard, small = false) {
    const url = !small || card.tcg === 'onepiece' ? card.image
        : card.tcg === 'pokemon' ? card.image.replace(/\/high\.png$/, '/low.png')
        : card.tcg === 'lorcana' ? card.image.replace('/digital/large/', '/digital/small/')
        : card.image.replace('/images/cards/', '/images/cards_small/');
    return `preview://tcg/image?url=${encodeURIComponent(url)}`;
}
