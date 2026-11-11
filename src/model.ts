export type ScryfallCard = {
    id: string,
    oracle_id?: string,
    name: string,
    set: string,
    set_name?: string,
    collector_number: string
    lang: string,
    image_status?: string,
    image_uris?: ScryfallImageUris,
    // Double-faced cards have it on their faces.
    illustration_id?: string,
    card_faces?: ScryfallCardFace[],
    full_art: boolean,
    frame: string,
    security_stamp?: string,
    promo_types?: string[],
    type_line: string,
    layout: string,
    prices?: ScryfallPrices,
    released_at?: string,
    border_color?: string,
    frame_effects?: string[],
    digital?: boolean,
    // 'nonfoil', 'foil', 'etched'; missing in printings stored before it was kept.
    finishes?: string[],
};

// Prices as Scryfall reports them (decimal strings, null when unknown); eur comes from Cardmarket.
export type ScryfallPrices = {
    eur?: string | null,
    eur_foil?: string | null,
    usd?: string | null,
    usd_foil?: string | null,
};

export type ScryfallCardFace = {
    name: string,
    oracle_id?: string,
    type_line: string,
    image_uris?: ScryfallImageUris,
    illustration_id?: string
};

export type ScryfallImageUris = {
    small: string,
    normal: string,
    large: string,
    png: string,
    art_crop: string,
    border_crop: string
};

export interface ProcessingProfile {
    name: string;
    outputDirectory: string;
    playwrightChannel: PlaywrightChannel,
    postProcessing: PostProcessingProfile,
    upscaling: UpscaylSettings,
}

export interface PostProcessingProfile {
    dpi: number,
    cardWidth: number,
    cornerRadius: number,
    bleedWidth: number,
    borderCrop: number,
    copyrightBehavior: 'keep' | 'blur' | 'proxy' | 'custom',
    // Printed over the blurred copyright line with 'custom'.
    copyrightText?: string,
    blurStrength: number
}

export interface UpscaylSettings {
    enabled: boolean,
    binaryFile?: string,
    modelsDirectory?: string,
    model: string
}

export enum PlaywrightChannel {
    Chrome = "chrome",
    Firefox = "firefox",
    WebKit = "webkit",
    MicrosoftEdge = "msedge"
}

export const DefaultProfile: ProcessingProfile = {
    name: 'default',
    outputDirectory: './orders',
    playwrightChannel: PlaywrightChannel.Chrome,
    postProcessing: {
        dpi: 300,
        cardWidth: 63 / 25.4,
        cornerRadius: 0.06,
        bleedWidth: 3 / 25.4,
        borderCrop: 0.005,
        copyrightBehavior: 'keep',
        blurStrength: 10,
    },
    upscaling: {
        enabled: false,
        model: 'upscayl-standard-4x'
    }
};

export interface DeckConfig {
    url: string;
    data: DeckData[];
    name?: string;
    // The pasted deck list of a Yu-Gi-Oh or Pokémon deck, whose url is then an id starting with "list:".
    list?: string;
}

export enum DeckData {
    MainBoard = "mainboard",
    Extra = "extra",
    SideBoard = "sideboard",
    Tokens = "tokens",
    Considering = "maybeboard",
    Attractions = "attractions",
    Contraptions = "contraptions",
    Stickers = "stickers",
    Planes = "planes",
    Schemes = "schemes"
}

// Multipliers: 1 leaves the image as it is.
export interface Adjustments {
    brightness: number;
    contrast: number;
}

// Print comes out darker than the screen, so orders start 10 % brighter.
export const DEFAULT_ADJUSTMENTS: Adjustments = { brightness: 1.1, contrast: 1 };
export const NO_ADJUSTMENTS: Adjustments = { brightness: 1, contrast: 1 };

// The card's own adjustments apply on top of the order's. Rounded to whole percent, as they appear in file names.
export function combineAdjustments(order: Adjustments, card: Adjustments | undefined): Adjustments {
    const percent = (value: number) => Math.round(value * 100) / 100;
    return {
        brightness: percent(order.brightness * (card?.brightness ?? 1)),
        contrast: percent(order.contrast * (card?.contrast ?? 1))
    };
}

// File names in the custom image store (config/images).
export interface CustomImage {
    front: string;
    back?: string;
}

// Google Drive ids of MPC Autofill images, picked for the card's printing.
export interface MpcfillImage {
    front?: string;
    back?: string;
}

export interface OrderCard {
    id: string;
    // The deck's URL; empty for cards added in the app, which no import touches.
    deck: string;
    board: string;
    name: string;
    quantity: number;
    isToken: boolean;
    excluded: boolean;
    // Moxfield has the card as foil or etched.
    foil?: boolean;
    printing?: ScryfallCard;
    tcgCard?: TcgCard;
    customImage?: CustomImage;
    mpcfill?: MpcfillImage;
    adjustments?: Adjustments;
    // What Moxfield had at the last import, to tell local edits apart from changes made in the deck.
    imported?: ImportedState;
}

export interface ImportedState {
    // Also the id of cards from Archidekt; orders store it under this name.
    moxfieldId: string;
    quantity: number;
    printingId?: string;
}

export type Shop = 'meinspiel' | 'printerstudio' | 'home';

export type Tcg = 'magic' | 'yugioh' | 'pokemon';

export const TCG_NAMES: Record<Tcg, string> = { magic: 'Magic', yugioh: 'Yu-Gi-Oh', pokemon: 'Pokémon' };

// Millimetres, without bleed.
export const CARD_SIZES: Record<Tcg, { width: number, height: number }> = {
    magic: { width: 63, height: 88 },
    yugioh: { width: 59, height: 86 },
    pokemon: { width: 63, height: 88 }
};

export function printsAt(tcg: Tcg, shop: Shop) {
    return tcg === 'magic' || shop === 'home';
}

// The languages TCGdex has Pokémon card images in.
export const POKEMON_LANGUAGES: [code: string, name: string][] = [['en', 'English'], ['de', 'German'], ['fr', 'French'], ['it', 'Italian'], ['es', 'Spanish']];

// A Yu-Gi-Oh artwork from YGOPRODeck, its id the passcode of the artwork, or a Pokémon card from TCGdex, its id like "sv03-125".
export type TcgCard =
    | { tcg: 'yugioh', id: number, image: string }
    | { tcg: 'pokemon', id: string, lang: string, image: string };

export function tcgCardKey(card: TcgCard) {
    return card.tcg === 'yugioh' ? String(card.id) : `${card.lang}-${card.id}`;
}

// The printing a card prints in, whatever the game.
export function printingId(card: Pick<OrderCard, 'printing' | 'tcgCard'>) {
    return card.printing?.id ?? (card.tcgCard && tcgCardKey(card.tcgCard));
}

export type Paper = 'a4' | 'letter';

// The PDF of an order printed at home, lengths in millimetres.
export interface HomePrint {
    paper: Paper;
    landscape: boolean;
    columns: number;
    rows: number;
    gap: number;
    // Of the 3 mm the print images have around the card.
    bleed: number;
    guides: 'none' | 'crop-marks' | 'cut-lines';
    // The PDF repeats all its pages this many times.
    copies: number;
    // Moves the cards right and down, for printers that pull the paper in early or late; orders saved before have none.
    offsetX?: number;
    offsetY?: number;
    cards: 'all' | 'tokens' | { deck: string };
}

export const DEFAULT_HOME_PRINT: HomePrint = {
    paper: 'a4', landscape: false, columns: 3, rows: 3, gap: 0, bleed: 0, guides: 'crop-marks', copies: 1, cards: 'all'
};

export interface Order {
    name: string;
    shop: Shop;
    tcg: Tcg;
    // The language of the Pokémon cards' images, English when missing.
    language?: string;
    profile: ProcessingProfile;
    decks: DeckConfig[];
    // Google Drive id of an MPC Autofill card back.
    cardBack: string;
    // Print order.
    cards: OrderCard[];
    adjustments: Adjustments;
    // The games of the last upload, so they can be found on meinspiel.de again. The fingerprint of its packs tells whether an upload that stopped can go on.
    uploaded?: { at: string, games: UploadedGame[], fingerprint?: string };
    homePrint?: HomePrint;
}

export const DefaultOrder: Order = {
    name: 'unnamed',
    shop: 'meinspiel',
    tcg: 'magic',
    profile: DefaultProfile,
    cardBack: '1osewJhv5oaP5glJsBpnFJq0pXNuPwZY2',
    decks: [],
    cards: [],
    adjustments: DEFAULT_ADJUSTMENTS
};

export interface UploadedGame {
    id: number,
    name: string,
    saved: boolean,
    url: string
}

export interface HandoverStep {
    label: string;
    state: 'pending' | 'active' | 'done' | 'warning' | 'failed';
    detail?: string;
    // How far the step is, where it can be counted: images uploaded, bytes sent.
    progress?: { done: number, total: number };
}

// Handing an order to a shop in its browser window, as the app and the bar over the shop's pages show it.
export interface Handover {
    order: string;
    title: string;
    steps: HandoverStep[];
    // Selectors of what the user is to fill in on the shop's page, with what to do there.
    highlight?: string[];
    callout?: string;
    // What is left to the user once every step is done.
    next?: string;
    // Pages to go on with, such as the games made, which open in the usual browser.
    links?: { label: string, url: string }[];
    // While the app works in the shop's page: it is covered, so no click gets in the way, and closing the window asks first.
    blocking?: boolean;
}

export type ProgressEvent =
    | { type: 'progress', done: number, total: number, message: string }
    | { type: 'face-ready', file: string, bytes: number }
    | { type: 'face-failed', file: string, error: string }
    | { type: 'handover', handover: Handover };

export type OnProgress = (event: ProgressEvent) => void;

export interface GpuStats {
    // Percent.
    utilization?: number;
    // °C of the hottest sensor.
    temperature?: number;
}

export function isMoxfieldDeckUrl(value: string) {
    try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`);
        return url.host === 'moxfield.com' && url.pathname.startsWith('/decks/');
    } catch {
        return false;
    }
}

export function isArchidektDeckUrl(value: string) {
    try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`);
        return ['archidekt.com', 'www.archidekt.com'].includes(url.host) && /^\/decks\/\d+/.test(url.pathname);
    } catch {
        return false;
    }
}

export function isDeckUrl(value: string) {
    return isMoxfieldDeckUrl(value) || isArchidektDeckUrl(value);
}

export function deckSite(url: string) {
    return isArchidektDeckUrl(url) ? 'Archidekt' : 'Moxfield';
}

// Order names become file and folder names.
// How many packs an upload that stopped has made, when the packs still print the same and its games are in the account.
export function packsToSkip(uploaded: Order['uploaded'], packs: number, fingerprint: string) {
    if (uploaded?.fingerprint !== fingerprint || uploaded.games.length >= packs || !uploaded.games.every(game => game.saved)) return 0;
    return uploaded.games.length;
}

export function isValidOrderName(name: string) {
    return name.trim() === name && name !== '' && name !== '.' && name !== '..' && !/[\\/:*?"<>|]/.test(name);
}

export function replaceDeckCards(cards: OrderCard[], deckUrl: string, imported: OrderCard[]): OrderCard[] {
    const position = cards.findIndex(card => card.deck === deckUrl);
    const others = cards.filter(card => card.deck !== deckUrl);
    if (position === -1) return [...others, ...imported];

    const before = cards.slice(0, position).filter(card => card.deck !== deckUrl);
    return [...before, ...imported, ...others.slice(before.length)];
}

// Cards of decks that were removed or changed are dropped, so only those decks get imported again. Cards added in the app stay.
export function withDecks(order: Order, decks: DeckConfig[]): Order {
    const kept = decks.map(deck => {
        const previous = order.decks.find(existing => existing.url === deck.url);
        const unchanged = previous !== undefined && sameBoards(previous.data, deck.data);
        return { deck: unchanged && previous.name !== undefined ? { ...deck, name: previous.name } : deck, unchanged };
    });
    const unchangedUrls = new Set(kept.filter(entry => entry.unchanged).map(entry => entry.deck.url));

    return { ...order, decks: kept.map(entry => entry.deck), cards: order.cards.filter(card => card.deck === '' || unchangedUrls.has(card.deck)) };
}

function sameBoards(a: DeckData[], b: DeckData[]) {
    return a.length === b.length && a.every(board => b.includes(board));
}

// Brings a deck's changes from Moxfield into the order while keeping what was edited here:
// own images, switched off cards, adjustments, picked printings and changed quantities.
export function updateDeckCards(cards: OrderCard[], deckUrl: string, imported: OrderCard[]) {
    // The copies of one Moxfield entry can be split over several entries here, one per printing.
    const groups = new Map<OrderCard, OrderCard[]>();
    let removed = 0;
    for (const card of cards) {
        if (card.deck !== deckUrl) continue;
        const fresh = imported.find(candidate => sameEntry(card, candidate) && (card.imported !== undefined || !groups.has(candidate)));
        if (fresh) groups.set(fresh, [...groups.get(fresh) ?? [], card]);
        else removed++;
    }

    const merged = new Map<OrderCard, OrderCard | undefined>();
    let changed = 0;
    for (const [fresh, group] of groups) {
        const quantities = groupQuantities(group, fresh);
        let groupChanged = false;
        group.forEach((card, index) => {
            const quantity = quantities[index]!;
            const result = quantity > 0 ? mergeCard(card, fresh, quantity) : undefined;
            if (result?.quantity !== card.quantity || printingId(result) !== printingId(card)) groupChanged = true;
            merged.set(card, result);
        });
        if (groupChanged) changed++;
    }

    const result: OrderCard[] = [];
    let lastOfDeck = -1;
    for (const card of cards) {
        if (card.deck !== deckUrl) {
            result.push(card);
        } else if (merged.has(card)) {
            const update = merged.get(card);
            if (update) result.push(update);
            lastOfDeck = result.length - 1;
        }
    }

    const added = imported.filter(fresh => !groups.has(fresh));
    result.splice(lastOfDeck === -1 ? result.length : lastOfDeck + 1, 0, ...added);
    return { cards: result, added: added.length, removed, changed };
}

// A count changed in Moxfield wins over counts edited here: added copies go to the first entry, removed ones come off the last.
function groupQuantities(group: OrderCard[], fresh: OrderCard) {
    const quantities = group.map(card => card.quantity);
    const before = group[0]!.imported;
    if (before !== undefined && fresh.quantity === before.quantity) return quantities;

    let missing = fresh.quantity - quantities.reduce((total, quantity) => total + quantity, 0);
    if (missing > 0) quantities[0]! += missing;
    for (let index = quantities.length - 1; missing < 0 && index >= 0; index--) {
        const taken = Math.min(quantities[index]!, -missing);
        quantities[index]! -= taken;
        missing += taken;
    }
    return quantities;
}

// Gives some copies of a card another printing. They join an entry of the same card that has the printing already,
// otherwise they get their own entry right after the card, unless all copies change.
// An MPC Autofill image belongs to the old printing, so the changed copies lose it. Returns the id of the entry the copies went to.
export function changePrinting(cards: OrderCard[], id: string, printing: ScryfallCard, copies: number): { cards: OrderCard[], id: string } {
    const card = cards.find(candidate => candidate.id === id);
    if (!card || card.printing?.id === printing.id) return { cards, id };

    const moved = Math.min(copies, card.quantity);
    const target = cards.find(other => other !== card && other.printing?.id === printing.id && !other.mpcfill && sameCard(other, card));
    if (target) {
        return {
            cards: cards
                .map(other => other === target ? { ...other, quantity: other.quantity + moved } : other === card ? { ...card, quantity: card.quantity - moved } : other)
                .filter(other => other.quantity > 0),
            id: target.id
        };
    }

    const { mpcfill: _, ...changed } = card;
    if (moved === card.quantity) return { cards: cards.map(other => other === card ? { ...changed, printing } : other), id };

    const split = { ...changed, id: crypto.randomUUID(), quantity: moved, printing };
    return { cards: cards.flatMap(other => other === card ? [{ ...card, quantity: card.quantity - moved }, split] : [other]), id: split.id };
}

// An image picked for one face; when it shows another printing, the card takes that printing and drops the images of the old one.
export function chooseMpcfillImage(card: OrderCard, face: 'front' | 'back', id: string, printing: ScryfallCard | undefined): OrderCard {
    const switches = printing !== undefined && printing.id !== card.printing?.id;
    return { ...card, ...(switches ? { printing } : {}), mpcfill: { ...(switches ? {} : card.mpcfill), [face]: id } };
}

// Entries of the same deck entry that only differ in their printing.
function sameCard(a: OrderCard, b: OrderCard) {
    return a.deck === b.deck && a.board === b.board && a.name === b.name && a.imported?.moxfieldId === b.imported?.moxfieldId
        && JSON.stringify([a.excluded, a.customImage, a.adjustments]) === JSON.stringify([b.excluded, b.customImage, b.adjustments]);
}

// Cards imported before the import state existed can only be matched by board and name.
function sameEntry(card: OrderCard, fresh: OrderCard) {
    if (card.board !== fresh.board) return false;
    return card.imported ? card.imported.moxfieldId === fresh.imported?.moxfieldId : card.name === fresh.name;
}

function mergeCard(card: OrderCard, fresh: OrderCard, quantity: number): OrderCard {
    const before = card.imported;
    // Without import state a printing picked here cannot be told apart, so it stays.
    const printingPickedHere = before === undefined || printingId(card) !== before.printingId;

    const printing = (printingPickedHere ? card.printing : undefined) ?? fresh.printing ?? card.printing;
    const tcgCard = (printingPickedHere ? card.tcgCard : undefined) ?? fresh.tcgCard ?? card.tcgCard;
    const { printing: _, tcgCard: ___, imported: __, mpcfill, ...rest } = card;

    return {
        ...rest,
        name: fresh.name,
        isToken: fresh.isToken,
        quantity,
        ...(printing ? { printing } : {}),
        ...(tcgCard ? { tcgCard } : {}),
        // The image was picked for the old printing.
        ...(mpcfill && printing?.id === card.printing?.id ? { mpcfill } : {}),
        ...(fresh.imported ? { imported: fresh.imported } : {})
    };
}
