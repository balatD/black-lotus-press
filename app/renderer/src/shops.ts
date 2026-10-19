import type { Shop } from "../../../src/model.js";
import meinspielLogo from "./assets/meinspiel.png";
import notmpcLogo from "./assets/notmpc.png";

export const SHOPS: Record<Shop, { name: string, logo: string, offer: string }> = {
    meinspiel: { name: 'meinspiel.de', logo: meinspielLogo, offer: 'CMYK PDFs in packs of 55 cards, uploaded to your account' },
    notmpc: { name: 'notmpc.eu', logo: notmpcLogo, offer: 'RGB images in decks of up to 612 cards, filled into their designer' }
};
