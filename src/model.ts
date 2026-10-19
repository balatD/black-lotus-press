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
}

export enum DeckData {
    MainBoard = "mainboard",
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
    deck: string;
    board: string;
    name: string;
    quantity: number;
    isToken: boolean;
    excluded: boolean;
    // Moxfield has the card as foil or etched.
    foil?: boolean;
    printing?: ScryfallCard;
    customImage?: CustomImage;
    mpcfill?: MpcfillImage;
    adjustments?: Adjustments;
    // What Moxfield had at the last import, to tell local edits apart from changes made in the deck.
    imported?: ImportedState;
}

export interface ImportedState {
    moxfieldId: string;
    quantity: number;
    printingId?: string;
}

export type Shop = 'meinspiel' | 'notmpc' | 'printerstudio';

export interface Order {
    name: string;
    shop: Shop;
    profile: ProcessingProfile;
    decks: DeckConfig[];
    // Google Drive id of an MPC Autofill card back.
    cardBack: string;
    // Print order.
    cards: OrderCard[];
    adjustments: Adjustments;
    // The games of the last upload, so they can be found on meinspiel.de again.
    uploaded?: { at: string, games: UploadedGame[] };
}

export const DefaultOrder: Order = {
    name: 'unnamed',
    shop: 'meinspiel',
    profile: DefaultProfile,
    cardBack: '1osewJhv5oaP5glJsBpnFJq0pXNuPwZY2',
    decks: [],
    cards: [],
    adjustments: DEFAULT_ADJUSTMENTS
};

export interface PackFiles {
    fronts: string,
    backs: string,
    bytes: number
}

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

// Order names become file and folder names.
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

// Cards of decks that were removed or changed are dropped, so only those decks get imported again.
export function withDecks(order: Order, decks: DeckConfig[]): Order {
    const kept = decks.map(deck => {
        const previous = order.decks.find(existing => existing.url === deck.url);
        const unchanged = previous !== undefined && sameBoards(previous.data, deck.data);
        return { deck: unchanged && previous.name !== undefined ? { ...deck, name: previous.name } : deck, unchanged };
    });
    const unchangedUrls = new Set(kept.filter(entry => entry.unchanged).map(entry => entry.deck.url));

    return { ...order, decks: kept.map(entry => entry.deck), cards: order.cards.filter(card => unchangedUrls.has(card.deck)) };
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
            if (result?.quantity !== card.quantity || result.printing?.id !== card.printing?.id) groupChanged = true;
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
    const printingPickedHere = before === undefined || card.printing?.id !== before.printingId;

    const printing = (printingPickedHere ? card.printing : undefined) ?? fresh.printing ?? card.printing;
    const { printing: _, imported: __, mpcfill, ...rest } = card;

    return {
        ...rest,
        name: fresh.name,
        isToken: fresh.isToken,
        quantity,
        ...(printing ? { printing } : {}),
        // The image was picked for the old printing.
        ...(mpcfill && printing?.id === card.printing?.id ? { mpcfill } : {}),
        ...(fresh.imported ? { imported: fresh.imported } : {})
    };
}
