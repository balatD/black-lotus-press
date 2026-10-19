import type { Shop } from "../../../src/model.js";
import meinspielLogo from "./assets/meinspiel.png";
import notmpcLogo from "./assets/notmpc.png";
import printerstudioLogo from "./assets/printerstudio.png";

// A shop that is not available cannot be chosen; its orders stay as they are until it is available again.
export const SHOPS: Record<Shop, { name: string, logo: string, offer: string, available: boolean }> = {
    meinspiel: { name: 'meinspiel.de', logo: meinspielLogo, offer: 'CMYK PDFs in packs of 55 cards, uploaded to your account', available: true },
    notmpc: { name: 'notmpc.eu', logo: notmpcLogo, offer: 'RGB images in decks of up to 612 cards, filled into their designer', available: false },
    printerstudio: { name: 'printerstudio.de', logo: printerstudioLogo, offer: 'RGB images in decks of up to 612 cards on Standard stock, filled into their designer', available: true }
};
