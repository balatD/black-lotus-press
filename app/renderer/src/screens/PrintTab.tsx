import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { AppWindow, ArrowLeft, Check, ChevronLeft, ChevronRight, CircleStop, CloudUpload, ExternalLink, FileCode, FileDown, FlipHorizontal2, FolderOpen, Gauge, Image as ImageIcon, ListPlus, Maximize2, Package, Printer, RectangleVertical, RotateCw, Scissors, Sun, Thermometer, WandSparkles, X, ZoomIn, ZoomOut } from "lucide-react";
import { cardSize, DEFAULT_ADJUSTMENTS, DEFAULT_HOME_PRINT, type GpuStats, type Handover, type HomePrint, type Order, type OrderCard, packsToSkip, type UploadedGame } from "../../../../src/model.js";
import {
    BLANK_FACE,
    buildPacks,
    cardBackFace,
    cardFaces,
    driveId,
    type Face,
    faceImageUris,
    fillFreeSlots,
    fillingTokens,
    mpcfillImage,
    packsFingerprint,
    type Slot
} from "../../../../src/pipeline/packs.js";
import { backSlots, fittingGrids, GUIDE_COLORS, guidePath, IMAGE_BLEED_MM, PAPERS, sheetLayout, withFittingGrid } from "../../../../src/output/sheetLayout.js";
import { adjustmentFilter, percent } from "../adjust.js";
import { AdjustmentSliders } from "../components/AdjustmentSliders.js";
import { useStoredState } from "../useStoredState.js";
import { api, errorMessage, wasStopped } from "../api.js";
import { tcgPreview } from "../shops.js";
import { count, describeProcessing } from "../format.js";
import { ColorBar, RegistrationMark } from "../components/Decor.js";
import { useProgress } from "../useProgress.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { useTasks } from "../useTasks.js";
import { useGpuStats } from "../useGpuStats.js";
import { SHOPS } from "../shops.js";
import { HandoverOverlay } from "../components/HandoverOverlay.js";

interface Props {
    order: Order;
    update(change: (order: Order) => Order): void;
    onFlush(): Promise<void>;
    onSetup(): void;
}

type Status = { version: string, files: Record<string, number> };

const MEINSPIEL_ACCOUNT = 'https://www.meinspiel.de/mein-konto';

const ZOOM_MIN = 70;
const ZOOM_MAX = 320;
const ZOOM_STEP = 30;

export function PrintTab({ order, update, onFlush, onSetup }: Props) {
    const [status, setStatus] = useState<Status>({ version: '', files: {} });
    // 0 fits the sheet to the window.
    const [zoom, setZoom] = useStoredState('print-zoom', 0);
    const [opened, setOpened] = useState<number>();
    const [error, setError] = useState<string>();
    const [packIndex, setPackIndex] = useState(0);
    const [side, setSide] = useState<'front' | 'back'>('front');
    const [savedXml, setSavedXml] = useState<string>();
    const [homeResult, setHomeResult] = useState<string>();
    const [homeBusy, setHomeBusy] = useState<'print' | 'save'>();
    // The error of every image that failed in a run of this tab, until it is made.
    const [failed, setFailed] = useState<Record<string, string>>({});
    // The hand-over to the shop, shown from the click on upload or send until it is closed.
    const [handover, setHandover] = useState<Handover>();
    const [showHandover, setShowHandover] = useState(false);
    const tasks = useTasks();
    const running = tasks.find(task => task.kind !== 'browser');
    const job = running?.order === order.name ? running : undefined;
    const browser = tasks.find(task => task.kind === 'browser' && task.order === order.name);
    const progress = useProgress(job !== undefined);
    const upscaling = order.profile.upscaling.enabled && order.profile.postProcessing.dpi > 300;
    const gpu = useGpuStats(job?.kind === 'process' && upscaling);

    const refresh = useCallback(() => api.imageStatus(order).then(setStatus, e => setError(errorMessage(e))), [order]);

    // Also when a job starts or ends, including one started before this tab was opened.
    useEffect(() => {
        void refresh();
    }, [refresh, running?.id]);

    useEffect(() => api.onProgress(event => {
        if (event.type === 'face-ready') {
            setStatus(current => ({ ...current, files: { ...current.files, [event.file]: event.bytes } }));
            setFailed(({ [event.file]: _, ...rest }) => rest);
        }
        if (event.type === 'face-failed') setFailed(current => ({ ...current, [event.file]: event.error }));
        if (event.type === 'handover' && event.handover.order === order.name) setHandover(event.handover);
    }), [order.name]);

    const { packs, droppedTokens } = buildPacks(order);
    const cards = new Map(order.cards.map(card => [card.id, card]));
    // Home prints the fronts of the cards only, unless it prints both sides.
    const backsAtHome = order.homePrint?.sides === 'both';
    const needed = new Set(packs.flat().flatMap(slot => order.shop !== 'home' ? [slot.front, slot.back] : slot.cardId === undefined ? [] : backsAtHome ? [slot.front, slot.back] : [slot.front]));
    const processed = [...needed].filter(file => status.files[file] !== undefined).length;
    const allProcessed = needed.size > 0 && processed === needed.size;
    const failedFiles = [...needed].filter(file => failed[file] !== undefined);
    // The XML has MPC Autofill images by their id and only needs the processed images of the other cards.
    const xmlReady = packs.flat().every(slot => {
        const card = slot.cardId === undefined ? undefined : cards.get(slot.cardId);
        const faces = card && cardFaces(card, order);
        return !faces || [faces.front, faces.back].every(face => driveId(face) !== undefined || status.files[face.file] !== undefined);
    });

    async function run<T>(work: () => Promise<T>, done?: (result: T) => void) {
        setError(undefined);
        try {
            await onFlush();
            const result = await work();
            done?.(result);
        } catch (e) {
            if (!wasStopped(e)) setError(errorMessage(e));
        }
    }

    const processImages = () => run(() => api.processImages(order));
    const reprocess = (files: string[]) => run(() => api.reprocessImages(order, files));
    const reprocessAll = () => {
        if (!window.confirm(`Process all images of ${order.name} again? Every card is downloaded, post-processed and upscaled anew, which can take a while.`)) return;
        void reprocess([...needed]);
    };
    const handOver = () => {
        setHandover(undefined);
        setShowHandover(true);
    };
    const fingerprint = packsFingerprint(packs, status.version);
    const skip = packsToSkip(order.uploaded, packs.length, fingerprint);
    // Missing images are processed first, so one click goes from the cards to the games; asked before, as processing can take long.
    // The games made before a pack failed are kept as well, so the next upload can go on after them.
    const upload = (done: UploadedGame[]) => {
        if (!window.confirm('Upload the card images to meinspiel.de? This confirms that you followed their design guidelines.')) return;
        void run(async () => {
            if (!allProcessed) await api.processImages(order);
            // Processing can change the version of the images, so the fingerprint is taken afterwards.
            const uploaded = packsFingerprint(packs, (await api.imageStatus(order)).version);
            handOver();
            return { ...await api.uploadPacks(order, done), fingerprint: uploaded };
        }, result => {
            if (result.games.length > 0) update(current => ({ ...current, uploaded: { at: new Date().toISOString(), games: result.games, fingerprint: result.fingerprint } }));
            if (result.error) setError(result.error);
        });
    };
    const sendToPrinterstudio = () => {
        handOver();
        void run(() => api.sendToPrinterstudio(order));
    };
    const saveXml = () => run(() => api.saveMpcfillXml(order), file => file && setSavedXml(file));
    const homePrint = order.homePrint ?? DEFAULT_HOME_PRINT;
    const homeOutput = (kind: 'print' | 'save', work: () => Promise<string | undefined>) => {
        setHomeBusy(kind);
        void run(work, setHomeResult).finally(() => setHomeBusy(undefined));
    };
    const printPages = () => homeOutput('print', async () => await api.printHome(order) ? 'Sent to the printer.' : undefined);
    const savePdf = () => homeOutput('save', async () => {
        const file = await api.saveHomePdf(order);
        return file && `Saved as ${file}`;
    });
    const saveCutFile = () => void run(() => api.saveCutFile(order), file => file && setHomeResult(`Saved the cut file as ${file}`));

    // At home the settings stay in reach when the cards picked there are none.
    if (packs.length === 0 && (order.shop !== 'home' || homePrint.cards === 'all')) {
        return (
            <div className="empty">
                <h2>Nothing to print yet</h2>
                <p>Import the decks on the Setup tab first.</p>
                <button className="primary" data-guide="setup" onClick={onSetup}><ArrowLeft/>Go to Setup</button>
            </div>
        );
    }

    const pack = packs[Math.min(packIndex, packs.length - 1)]!;
    const unit = order.shop === 'meinspiel' ? 'Pack' : 'Deck';

    return (
        <div className="print">
            {showHandover && handover && (
                <HandoverOverlay handover={handover} running={job?.kind === 'upload'} browserOpen={job?.kind === 'upload' || browser !== undefined}
                                 onShowBrowser={() => void api.showShopBrowser()} onCancel={() => job && void api.stopTask(job.id)}
                                 onClose={() => setShowHandover(false)}/>
            )}
            <ol className="steps">
                <li>
                    <h2><WandSparkles/>Process the card images</h2>
                    <p className="muted">{processed} of {needed.size} images are ready ({describeProcessing(order.profile)}).</p>
                    <div className="row">
                        <button className={order.shop === 'meinspiel' ? '' : 'primary'} data-guide={order.shop !== 'meinspiel' && !allProcessed ? 'handover' : undefined}
                                disabled={running !== undefined || allProcessed} onClick={() => void processImages()}>
                            {allProcessed ? <><Check/>All images are ready</> : <><WandSparkles/>Process images</>}
                        </button>
                        {job?.kind === 'process' && <button className="quiet" onClick={() => void api.stopTask(job.id)}><CircleStop/>Cancel</button>}
                        {job?.kind !== 'process' && processed > 0 && (
                            <button className="quiet" disabled={running !== undefined} onClick={reprocessAll}><RotateCw/>Process all again</button>
                        )}
                        {job?.kind !== 'process' && failedFiles.length > 0 && (
                            <button disabled={running !== undefined} title="Downloads, post-processes and upscales them again" onClick={() => void reprocess(failedFiles)}><RotateCw/>Retry the failed images</button>
                        )}
                    </div>
                    {job?.kind === 'process' && <ProgressBar progress={progress} label="Processing card images"/>}
                    {gpu && <GpuStatus stats={gpu}/>}
                </li>
                {order.shop === 'meinspiel' && (
                <li>
                    <h2><CloudUpload/>Upload to meinspiel.de</h2>
                    <p className="muted">
                        A browser window opens over the app: log in there, and it shows every step. Every pack becomes a game in your account, with an image of
                        full resolution for every card side; at 1200 dpi that can take a while. Then the browser closes and the app lists the games; you choose the box and order on meinspiel.de yourself.
                    </p>
                    <div className="row">
                        {skip > 0 ? <>
                            <button className="primary" data-guide="handover" disabled={running !== undefined} onClick={() => upload(order.uploaded!.games)}><CloudUpload/>Continue with pack {skip + 1}</button>
                            <button disabled={running !== undefined} onClick={() => upload([])}><RotateCw/>Upload all again</button>
                        </> : (
                            <button className={order.uploaded ? '' : 'primary'} data-guide="handover" disabled={running !== undefined || needed.size === 0} onClick={() => upload([])}>
                                <CloudUpload/>{allProcessed ? 'Upload' : 'Process images and upload'}
                            </button>
                        )}
                        {job?.kind === 'upload' && <button className="quiet" onClick={() => void api.stopTask(job.id)}><CircleStop/>Cancel</button>}
                        {browser && <button className="quiet" onClick={() => void api.stopTask(browser.id)}><AppWindow/>Close browser</button>}
                        <button className="quiet" onClick={() => void api.openOrderFolder(order)}><FolderOpen/>Open order folder</button>
                    </div>
                    {job?.kind === 'upload' && <ProgressBar progress={progress} label="Opening the browser"/>}
                    {order.uploaded && (
                        <>
                            <ul className="files">
                                {order.uploaded.games.map(game => (
                                    <li key={game.id} className={game.saved ? '' : 'warning'}>
                                        <a href={game.url} target="_blank" rel="noreferrer">{game.name}<ExternalLink/></a>
                                        : {game.saved ? 'saved in your account' : 'not saved in your account. Click "Speichern" in its window of the upload browser.'}
                                    </li>
                                ))}
                            </ul>
                            <p className="status">
                                Uploaded {new Date(order.uploaded.at).toLocaleString()}. The links open in your usual browser, which needs to be logged in to meinspiel.de as well.
                                All your games are in <a href={MEINSPIEL_ACCOUNT} target="_blank" rel="noreferrer">your meinspiel.de account<ExternalLink/></a> under "Gestaltete Spiele".
                            </p>
                        </>
                    )}
                </li>
                )}
                {order.shop === 'home' && (
                    <li>
                        <h2><Printer/>Print the cards</h2>
                        <p className="muted">
                            The fronts of the cards on {PAPERS[homePrint.paper].name} pages, laid out as set below. Print opens your system's print dialog, Save PDF saves the pages
                            as a PDF and opens it. Print at actual size (100 %), not fit to page, so the cards come out at {cardSize(order).width} × {cardSize(order).height} mm.
                        </p>
                        <div className="row">
                            <button className={allProcessed ? 'primary' : ''} data-guide={allProcessed ? 'handover' : undefined} disabled={running !== undefined || !allProcessed || homeBusy !== undefined} onClick={printPages}>
                                <Printer/>{homeBusy === 'print' ? 'Printing…' : 'Print…'}
                            </button>
                            <button disabled={running !== undefined || !allProcessed || homeBusy !== undefined} onClick={savePdf}>
                                <FileDown/>{homeBusy === 'save' ? 'Saving the PDF…' : 'Save PDF'}
                            </button>
                            {homePrint.cutter === 'silhouette' && <button onClick={saveCutFile}><Scissors/>Save cut file</button>}
                        </div>
                        {homePrint.cutter === 'silhouette' && (
                            <p className="status">
                                Print the pages, then open the cut file in Silhouette Studio, page size {PAPERS[homePrint.paper].name}{homePrint.landscape ? ' landscape' : ''}, and use
                                Center to Page. Turn on the registration marks with length {homePrint.regLength} mm, thickness {homePrint.regThickness} mm and inset {homePrint.regInset} mm,
                                as printed. Basic Edition opens the DXF, Designer Edition and up the SVG too. Try one page first: the marks follow silhouette-card-maker and are not tested
                                with every machine.
                            </p>
                        )}
                        {homeResult && <span className="status">{homeResult}</span>}
                    </li>
                )}
                {order.shop === 'printerstudio' && (
                    <li>
                        <h2><CloudUpload/>Send to printerstudio.de</h2>
                        <p className="muted">
                            The browser opens printerstudio.de, where you log in or sign up first. Then the app fills their designer for 63 × 88 mm cards on Standard (glatt) stock,
                            one window per deck, and saves each deck as a project in your account, named after the order and the date. Each window stops at the preview:
                            check it, confirm the copyright and put the deck into the cart yourself.
                        </p>
                        <div className="row">
                            <button className={allProcessed && !browser ? 'primary' : ''} data-guide={allProcessed ? 'handover' : undefined} disabled={running !== undefined || !allProcessed} onClick={() => void sendToPrinterstudio()}><CloudUpload/>Send to printerstudio.de</button>
                            {job?.kind === 'upload' && <button className="quiet" onClick={() => void api.stopTask(job.id)}><CircleStop/>Cancel</button>}
                            {browser && <button className="quiet" onClick={() => void api.stopTask(browser.id)}><AppWindow/>Close browser</button>}
                        </div>
                        {job?.kind === 'upload' && <ProgressBar progress={progress} label="Opening the browser"/>}
                    </li>
                )}
            </ol>

            {error && <p className="error" role="alert" style={{ whiteSpace: 'pre-line' }}>{error}</p>}

            {order.shop === 'home' && <HomeSheet order={order} update={update} pages={packs} cards={cards} status={status}/>}

            {order.shop !== 'home' && <section className="xml-section">
                <h2><FileCode/>MPC Autofill XML</h2>
                <p className="muted">
                    The cards of this order as an order file of MPC Autofill: its images by their ID, the other cards as their processed images on this computer.
                    MPC Autofill's desktop tool orders it at MakePlayingCards or PrinterStudio; its editor on mpcfill.com takes it as well, with images of its own for the cards from this computer.
                </p>
                <div className="row">
                    <button disabled={running !== undefined || !xmlReady} onClick={() => void saveXml()}><FileDown/>Save MPC Autofill XML</button>
                    {!xmlReady && <span className="status">Process the images first: the cards without an MPC Autofill image go into the XML as their processed images.</span>}
                    {savedXml && <span className="status">Saved as {savedXml}</span>}
                </div>
            </section>}

            <section className="adjust-section">
                <h2><Sun/>Brightness, contrast and edges</h2>
                <AdjustmentSliders
                    withEdges
                    adjustments={order.adjustments}
                    onChange={adjustments => update(current => ({ ...current, adjustments }))}
                    onReset={() => update(current => ({ ...current, adjustments: DEFAULT_ADJUSTMENTS }))}
                    resetLabel={`Back to ${percent(DEFAULT_ADJUSTMENTS.brightness)} and ${percent(DEFAULT_ADJUSTMENTS.contrast)}`}
                    canReset={order.adjustments.brightness !== DEFAULT_ADJUSTMENTS.brightness || order.adjustments.contrast !== DEFAULT_ADJUSTMENTS.contrast || order.adjustments.edges !== undefined}/>
                <p className="status">
                    For every card of this order; single cards can get their own on top in the Cards tab. Print comes out darker than the screen,
                    which is why it starts at {percent(DEFAULT_ADJUSTMENTS.brightness)}. The sheet below shows changes right away. Process the images afterwards:
                    that only takes seconds, because the upscaled images are kept. Darken edges darkens the bleed and border of every card, so black borders print
                    deep black and a cut a little off shows no grey edge; white borders stay white. It shows in the processed images, not on the sheet.
                </p>
            </section>

            {order.shop !== 'home' && <section className="sheet-section">
                <div className="row">
                    <div className="tabs" role="tablist" aria-label={unit}>
                        {packs.map((_, index) => (
                            <button key={index} role="tab" aria-selected={index === packIndex} onClick={() => setPackIndex(index)}><Package/>{unit} {index + 1}</button>
                        ))}
                    </div>
                    <div className="tabs" role="tablist" aria-label="Side">
                        <button role="tab" aria-selected={side === 'front'} onClick={() => setSide('front')}><ImageIcon/>Fronts</button>
                        <button role="tab" aria-selected={side === 'back'} onClick={() => setSide('back')}><RectangleVertical/>Backs</button>
                    </div>
                    <span className="status grow" style={{ textAlign: 'right' }}>
                        {describePack(pack)}. Approximate print preview, click a card to see it large.
                    </span>
                    <div className="zoom">
                        <button className="quiet" aria-pressed={zoom === 0} onClick={() => setZoom(0)}><Maximize2/>Fit</button>
                        <button className="quiet" aria-label="Smaller cards" onClick={() => setZoom(Math.max(ZOOM_MIN, (zoom || 110) - ZOOM_STEP))}><ZoomOut/></button>
                        <input type="range" aria-label="Sheet zoom" min={ZOOM_MIN} max={ZOOM_MAX} step={10} value={zoom || 110} onChange={e => setZoom(Number(e.target.value))}/>
                        <button className="quiet" aria-label="Bigger cards" onClick={() => setZoom(Math.min(ZOOM_MAX, (zoom || 110) + ZOOM_STEP))}><ZoomIn/></button>
                    </div>
                </div>
                <div className="sheet-scroller">
                <div className={`press-sheet${zoom ? ' zoomed' : ''}`} style={zoom ? { '--slot-width': `${zoom}px` } as CSSProperties : undefined}>
                    {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(corner => <RegistrationMark key={corner} size={20} className={`sheet-mark ${corner}`}/>)}
                    <ColorBar className="sheet-bar"/>
                    <ol className="sheet">
                        {pack.map((slot, index) => (
                            <SheetSlot key={index} side={side} card={slot.cardId === undefined ? undefined : cards.get(slot.cardId)} order={order} status={status}
                                       failed={failed} onOpen={() => setOpened(index)}/>
                        ))}
                    </ol>
                    <p className="slug">
                        <span>{SHOPS[order.shop].name}</span>
                        <span>{order.name}</span>
                        <span>{unit} {packIndex + 1} of {packs.length}</span>
                        <span>{side === 'front' ? 'Fronts' : 'Backs'}</span>
                        <span>69 × 94 mm with 3 mm bleed</span>
                        <span>{order.profile.postProcessing.dpi} dpi</span>
                        <span>sRGB</span>
                    </p>
                </div>
                </div>
                {opened !== undefined && (
                    <SlotDialog pack={pack} packNumber={packIndex + 1} index={opened} cards={cards} order={order} status={status} failed={failed}
                                busy={running !== undefined} onReprocess={files => void reprocess(files)}
                                onIndex={setOpened} onClose={() => setOpened(undefined)}/>
                )}
                {droppedTokens.length > 0 && (
                    <p className="muted">Not in any {unit.toLowerCase()} because they would need {order.shop === 'meinspiel' ? 'another one' : 'a larger one'}: {droppedTokens.map(token => token.copies > 1 ? `${token.card.name} ×${token.copies}` : token.card.name).join(', ')}.</p>
                )}
            </section>}
        </div>
    );
}

const GAPS = [0, 1, 2, 3, 5];
const BLEEDS = [0, 0.5, 1, 1.5, 2, 3];
const GUIDE_WIDTHS = [0.25, 0.5, 1, 2];
const MARK_LENGTHS = [2, 4, 6, 8];
const MARK_OFFSETS = [0, 1, 2, 3];
const CARD_GUIDE_LENGTHS = [3, 6, 10];
const REG_LENGTHS = [5, 10, 15, 20];
const REG_THICKNESSES = [0.5, 1];
const REG_INSETS = [10, 12.5, 15];

// A text field, so that a minus sign or a comma on its own can be typed; the value changes once it is a number.
function Millimetres({ id, value, onChange }: { id: string, value: number, onChange(value: number): void }) {
    const [draft, setDraft] = useState(String(value));
    // Takes the value when it changed elsewhere or was limited, and keeps what is typed otherwise, such as "4.".
    useEffect(() => setDraft(draft => Number(draft.replace(',', '.')) === value ? draft : String(value)), [value]);
    return (
        <div className="row">
            <input id={id} inputMode="decimal" value={draft} style={{ width: '7rem' }} onBlur={() => setDraft(String(value))} onChange={e => {
                setDraft(e.target.value);
                const number = Number(e.target.value.replace(',', '.'));
                if (e.target.value.trim() !== '' && Number.isFinite(number)) onChange(number);
            }}/>
            <span>mm</span>
        </div>
    );
}

// The settings of the PDF next to a page as it prints, drawn from the same layout as the PDF.
function HomeSheet({ order, update, pages, cards, status }: {
    order: Order, update(change: (order: Order) => Order): void, pages: Slot[][], cards: Map<string, OrderCard>, status: Status
}) {
    const [pageIndex, setPageIndex] = useState(0);
    const [showBacks, setShowBacks] = useState(false);
    const settings = order.homePrint ?? DEFAULT_HOME_PRINT;
    const side = settings.sides === 'both' && showBacks ? 'back' : 'front';
    const page = Math.min(pageIndex, pages.length - 1);
    const blank = pages.at(-1)?.filter(slot => slot.cardId === undefined).length ?? 0;
    const tokens = fillingTokens(order);
    const decks = order.decks.filter(deck => order.cards.some(card => card.deck === deck.url));
    const grids = fittingGrids(settings, cardSize(order));
    const gridKey = (grid: Pick<HomePrint, 'landscape' | 'columns' | 'rows'>) => `${grid.columns}x${grid.rows}${grid.landscape ? '-landscape' : ''}`;
    const set = (change: Partial<HomePrint>) => update(current => ({ ...current, homePrint: withFittingGrid({ ...(current.homePrint ?? DEFAULT_HOME_PRINT), ...change }, cardSize(current)) }));

    return (
        <section className="home-section">
            <div className="home-settings">
                <h2><Printer/>Print settings</h2>
                <div className="field">
                    <label htmlFor="home-paper">Paper</label>
                    <select id="home-paper" value={settings.paper} onChange={e => set({ paper: e.target.value as HomePrint['paper'] })}>
                        <option value="a4">A4, 210 × 297 mm</option>
                        <option value="letter">Letter, 8.5 × 11 in</option>
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="home-grid">Cards per page</label>
                    <select id="home-grid" value={gridKey(settings)} onChange={e => set(grids.find(grid => gridKey(grid) === e.target.value)!)}>
                        {grids.map(grid => (
                            <option key={gridKey(grid)} value={gridKey(grid)}>{grid.columns * grid.rows} ({grid.columns} × {grid.rows}{grid.landscape ? ', landscape' : ''})</option>
                        ))}
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="home-cards">Cards</label>
                    <select id="home-cards" value={typeof settings.cards === 'string' ? settings.cards : `deck:${settings.cards.deck}`}
                            onChange={e => set({ cards: e.target.value.startsWith('deck:') ? { deck: e.target.value.slice('deck:'.length) } : e.target.value as 'all' | 'tokens' })}>
                        <option value="all">All cards</option>
                        {order.tcg === 'magic' && <option value="tokens">Only the tokens</option>}
                        {decks.map(deck => <option key={deck.url} value={`deck:${deck.url}`}>Only {deck.name ?? deck.url}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="home-sides">Sides</label>
                    <select id="home-sides" value={settings.sides} onChange={e => set({ sides: e.target.value as HomePrint['sides'] })}>
                        <option value="fronts">Fronts only</option>
                        <option value="both">Fronts and backs, to print on both sides</option>
                    </select>
                    {settings.sides === 'both' && <p className="hint">Every page of fronts is followed by the page of their backs. Double-faced cards get their back face, the others the card back of the Setup tab. Turn on two-sided printing in the print dialog.</p>}
                </div>
                {settings.sides === 'both' && <>
                    <div className="field">
                        <label htmlFor="home-flip">Turn the paper over on</label>
                        <select id="home-flip" value={settings.flip} onChange={e => set({ flip: e.target.value as HomePrint['flip'] })}>
                            <option value="long">The long edge</option>
                            <option value="short">The short edge</option>
                        </select>
                        <p className="hint">As set for two-sided printing in the print dialog, often called long-edge or short-edge binding.</p>
                    </div>
                    <div className="field">
                        <label htmlFor="home-back-offset-y">Move the backs down</label>
                        <Millimetres id="home-back-offset-y" value={settings.backOffsetY} onChange={backOffsetY => set({ backOffsetY })}/>
                    </div>
                    <div className="field">
                        <label htmlFor="home-back-offset-x">Move the backs right</label>
                        <Millimetres id="home-back-offset-x" value={settings.backOffsetX} onChange={backOffsetX => set({ backOffsetX })}/>
                        <p className="hint">When the backs come out a little off the fronts: hold a printed page against the light and move the backs by as much as they are off, as seen on the backs.</p>
                    </div>
                </>}
                <div className="field">
                    <label htmlFor="home-copies">Copies</label>
                    <input id="home-copies" type="number" min={1} max={99} value={settings.copies} style={{ width: '7rem' }}
                           onChange={e => set({ copies: Math.min(99, Math.max(1, Math.round(Number(e.target.value)) || 1)) })}/>
                </div>
                <div className="field">
                    <label htmlFor="home-gap">Space between cards</label>
                    <select id="home-gap" value={settings.gap} onChange={e => set({ gap: Number(e.target.value) })}>
                        {GAPS.map(gap => <option key={gap} value={gap}>{gap === 0 ? 'None, the cards touch' : `${gap} mm`}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="home-bleed">Bleed</label>
                    <select id="home-bleed" value={settings.bleed} onChange={e => set({ bleed: Number(e.target.value) })}>
                        {BLEEDS.map(bleed => <option key={bleed} value={bleed}>{bleed === 0 ? 'None' : `${bleed} mm`}</option>)}
                    </select>
                    <p className="hint">More of the image around each card, so a cut a little off leaves no white edge. Each card then needs cuts of its own.</p>
                </div>
                <div className="field">
                    <label htmlFor="home-guides">Page guides</label>
                    <select id="home-guides" value={settings.guides} onChange={e => set({ guides: e.target.value as HomePrint['guides'] })}>
                        <option value="crop-marks">Crop marks in the margins</option>
                        <option value="edges">Lines from the paper edges to the cards</option>
                        <option value="cut-lines-outside">Cut lines outside the cards</option>
                        <option value="cut-lines">Cut lines across the page</option>
                        <option value="none">None</option>
                    </select>
                </div>
                {settings.guides === 'crop-marks' && <>
                    <div className="field">
                        <label htmlFor="home-mark-length">Crop mark length</label>
                        <select id="home-mark-length" value={settings.markLength} onChange={e => set({ markLength: Number(e.target.value) })}>
                            {MARK_LENGTHS.map(length => <option key={length} value={length}>{length} mm</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="home-mark-offset">Space between cards and crop marks</label>
                        <select id="home-mark-offset" value={settings.markOffset} onChange={e => set({ markOffset: Number(e.target.value) })}>
                            {MARK_OFFSETS.map(offset => <option key={offset} value={offset}>{offset === 0 ? 'None, the marks touch the cards' : `${offset} mm`}</option>)}
                        </select>
                    </div>
                </>}
                <div className="field">
                    <label htmlFor="home-card-guides">Card guides</label>
                    <select id="home-card-guides" value={settings.cardGuides} onChange={e => set({ cardGuides: e.target.value as HomePrint['cardGuides'] })}>
                        <option value="none">None</option>
                        <option value="corners">At the corners of every card</option>
                        <option value="full">All around every card</option>
                    </select>
                </div>
                {settings.cardGuides !== 'none' && <>
                    <div className="field">
                        <label htmlFor="home-card-guide-corners">Card guide corners</label>
                        <select id="home-card-guide-corners" value={settings.cardGuideCorners} onChange={e => set({ cardGuideCorners: e.target.value as HomePrint['cardGuideCorners'] })}>
                            <option value="square">Square</option>
                            <option value="round">Round, like the card</option>
                        </select>
                    </div>
                    {settings.cardGuides === 'corners' && (
                        <div className="field">
                            <label htmlFor="home-card-guide-length">Card guide length</label>
                            <select id="home-card-guide-length" value={settings.cardGuideLength} onChange={e => set({ cardGuideLength: Number(e.target.value) })}>
                                {CARD_GUIDE_LENGTHS.map(length => <option key={length} value={length}>{length} mm along each edge</option>)}
                            </select>
                            <p className="hint">Short guides are easier to cut away when a cut is a little off.</p>
                        </div>
                    )}
                    <div className="field">
                        <label htmlFor="home-card-guide-placement">Card guide placement</label>
                        <select id="home-card-guide-placement" value={settings.cardGuidePlacement} onChange={e => set({ cardGuidePlacement: e.target.value as HomePrint['cardGuidePlacement'] })}>
                            <option value="outside">Outside the cut, in the bleed</option>
                            <option value="center">On the cut</option>
                            <option value="inside">Inside the cut, on the card</option>
                        </select>
                    </div>
                </>}
                {(settings.guides !== 'none' || settings.cardGuides !== 'none') && <>
                    <div className="field">
                        <label htmlFor="home-guide-color">Guide colour</label>
                        <select id="home-guide-color" value={settings.guideColor} onChange={e => set({ guideColor: e.target.value as HomePrint['guideColor'] })}>
                            {Object.entries(GUIDE_COLORS).map(([color, { name }]) => <option key={color} value={color}>{name}</option>)}
                        </select>
                        <p className="hint">Magenta shows on black, white and coloured card borders alike.</p>
                    </div>
                    <div className="field">
                        <label htmlFor="home-guide-width">Guide width</label>
                        <select id="home-guide-width" value={settings.guideWidth} onChange={e => set({ guideWidth: Number(e.target.value) })}>
                            {GUIDE_WIDTHS.map(width => <option key={width} value={width}>{width} pt</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="home-guide-style">Guide style</label>
                        <select id="home-guide-style" value={settings.guideStyle} onChange={e => set({ guideStyle: e.target.value as HomePrint['guideStyle'] })}>
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                        </select>
                    </div>
                </>}
                <div className="field">
                    <label htmlFor="home-cutter">Cutter</label>
                    <select id="home-cutter" value={settings.cutter} onChange={e => set({ cutter: e.target.value as HomePrint['cutter'] })}>
                        <option value="none">None, the cards are cut by hand</option>
                        <option value="silhouette">Silhouette Cameo or Portrait, print and cut</option>
                    </select>
                    {settings.cutter === 'silhouette' && <p className="hint">The pages get the three registration marks of Silhouette Studio, and the cards stay inside them. Page guides and moving the cards are left out: the cutter finds the cards by the marks.</p>}
                </div>
                {settings.cutter === 'silhouette' && <>
                    <div className="field">
                        <label htmlFor="home-reg-length">Registration mark length</label>
                        <select id="home-reg-length" value={settings.regLength} onChange={e => set({ regLength: Number(e.target.value) })}>
                            {REG_LENGTHS.map(length => <option key={length} value={length}>{length} mm</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="home-reg-thickness">Registration mark thickness</label>
                        <select id="home-reg-thickness" value={settings.regThickness} onChange={e => set({ regThickness: Number(e.target.value) })}>
                            {REG_THICKNESSES.map(thickness => <option key={thickness} value={thickness}>{thickness} mm</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="home-reg-inset">Registration mark inset</label>
                        <select id="home-reg-inset" value={settings.regInset} onChange={e => set({ regInset: Number(e.target.value) })}>
                            {REG_INSETS.map(inset => <option key={inset} value={inset}>{inset} mm from the paper's edge</option>)}
                        </select>
                        <p className="hint">Set the same three values for the registration marks in Silhouette Studio.</p>
                    </div>
                    <div className="field">
                        <label htmlFor="home-cut-corners">Cut corners</label>
                        <select id="home-cut-corners" value={settings.cutCorners} onChange={e => set({ cutCorners: e.target.value as HomePrint['cutCorners'] })}>
                            <option value="round">Round, like the card</option>
                            <option value="square">Square</option>
                        </select>
                    </div>
                </>}
                {settings.cutter !== 'silhouette' && <>
                    <div className="field">
                        <label htmlFor="home-offset-y">Move the cards down</label>
                        <Millimetres id="home-offset-y" value={settings.offsetY ?? 0} onChange={offsetY => set({ offsetY })}/>
                    </div>
                    <div className="field">
                        <label htmlFor="home-offset-x">Move the cards right</label>
                        <Millimetres id="home-offset-x" value={settings.offsetX ?? 0} onChange={offsetX => set({ offsetX })}/>
                        <p className="hint">For a printer that pulls the paper in early or late: when the top row comes out cut off, move the cards down by as much as is missing. Negative numbers move them up or left.</p>
                    </div>
                </>}
            </div>
            <div className="home-preview">
                {pages.length === 0 ? <p className="status">None of the cards are picked to print. Choose other cards in the settings.</p> : <>
                    <div className="row">
                        <button className="quiet" aria-label="Previous page" disabled={page === 0} onClick={() => setPageIndex(page - 1)}><ChevronLeft/></button>
                        <span className="status">Page {page + 1} of {pages.length}{settings.copies > 1 ? `, all printed ${settings.copies} times` : ''}</span>
                        <button className="quiet" aria-label="Next page" disabled={page === pages.length - 1} onClick={() => setPageIndex(page + 1)}><ChevronRight/></button>
                        {settings.sides === 'both' && <button className="quiet" aria-pressed={showBacks} onClick={() => setShowBacks(!showBacks)}><FlipHorizontal2/>Backs</button>}
                    </div>
                    {blank > 0 && (
                        <div className="row">
                            <span className="warning">
                                {count(blank, 'slot')} on the last page {blank === 1 ? 'stays' : 'stay'} empty.
                                {order.tcg === 'magic' && <> Fill {blank === 1 ? 'it' : 'them'} with tokens, so no paper goes to waste{tokens.length > 0 ? '.' : ': add tokens on the Cards tab with Find a token….'}</>}
                            </span>
                            {order.tcg === 'magic' && tokens.length > 0 && <button onClick={() => update(current => ({ ...current, cards: fillFreeSlots(current) }))}><ListPlus/>Fill with tokens</button>}
                        </div>
                    )}
                    <HomePage settings={settings} side={side} slots={pages[page]!} cards={cards} order={order} status={status}/>
                </>}
            </div>
        </section>
    );
}

function HomePage({ settings, side, slots, cards, order, status }: {
    settings: HomePrint, side: 'front' | 'back', slots: Slot[], cards: Map<string, OrderCard>, order: Order, status: Status
}) {
    const layout = sheetLayout(settings, cardSize(order));
    const boxes = side === 'back' ? backSlots(layout, settings) : layout.slots;
    const percent = (value: number, of: number) => `${value / of * 100}%`;
    // The print images are larger than the slots by the bleed they have and the slots do not.
    const overhang = IMAGE_BLEED_MM - settings.bleed;

    return (
        <div className="home-page" style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
            {slots.map((slot, index) => {
                const box = boxes[index]!;
                const card = slot.cardId === undefined ? undefined : cards.get(slot.cardId);
                const faces = card && cardFaces(card, order);
                const face = faces && (faces.back.file === slot[side] ? faces.back : faces.front);
                const image = face && slotImage(face, order, status);
                return (
                    <div key={index} className={`home-slot${card ? '' : ' blank'}`} title={card?.name ?? 'Empty, room for a token'}
                         style={{ left: percent(box.x, layout.width), top: percent(box.y, layout.height), width: percent(box.width, layout.width), height: percent(box.height, layout.height) }}>
                        {image?.src && <img src={image.src} alt={card?.name} loading="lazy" style={{
                            left: percent(-overhang, box.width), top: percent(-overhang, box.height),
                            width: percent(box.width + 2 * overhang, box.width), height: percent(box.height + 2 * overhang, box.height),
                            ...(image.filter ? { filter: image.filter } : {})
                        }}/>}
                    </div>
                );
            })}
            {side === 'front' && (
                <svg className="home-guides" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" fill="none" stroke={layout.stroke.color}
                     strokeWidth={layout.stroke.width} strokeDasharray={layout.stroke.dash.join(' ') || 'none'} strokeLinecap={layout.stroke.cap}>
                    <path d={guidePath(layout, slots.map(slot => slot.cardId !== undefined))}/>
                    {layout.marks.map((mark, index) => <rect key={index} {...mark} fill="#000" stroke="none"/>)}
                </svg>
            )}
        </div>
    );
}

interface SlotProps {
    side: 'front' | 'back';
    card: OrderCard | undefined;
    order: Order;
    status: Status;
    failed: Record<string, string>;
}

function SheetSlot({ side, card, order, status, failed, onOpen }: SlotProps & { onOpen(): void }) {
    const face = slotFace(side, card, order);
    const label = card ? `${card.name}${side === 'back' && face.source.type === 'cardback' ? ' (card back)' : ''}` : 'Blank card';
    const error = failed[face.file];

    return (
        <li className={`slot${card ? '' : ' blank'}${error ? ' failed' : ''}`}>
            <button className="slot-button" title={error ? `${label}. Failed: ${error}` : label} onClick={onOpen}>
                <SlotImage face={face} order={order} status={status} label={label}/>
                {card?.isToken && <span className="slot-tag">Token</span>}
            </button>
        </li>
    );
}

function SlotImage({ face, order, status, label }: { face: Face, order: Order, status: Status, label: string }) {
    const image = slotImage(face, order, status);
    return (
        <>
            {image.src
                ? <img src={image.src} alt={label} loading="lazy" style={image.filter ? { filter: image.filter } : undefined}/>
                : <span className="slot-placeholder">{face.source.type === 'blank' ? '' : label}</span>}
            {!image.done && face.source.type !== 'blank' && <span className="slot-pending" title="Not processed with these settings yet"/>}
        </>
    );
}

function SlotDialog({ pack, packNumber, index, cards, order, status, failed, busy, onReprocess, onIndex, onClose }: {
    pack: Slot[], packNumber: number, index: number, cards: Map<string, OrderCard>, order: Order, status: Status, failed: Record<string, string>, busy: boolean,
    onReprocess(files: string[]): void, onIndex(index: number): void, onClose(): void
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const slot = pack[index]!;
    const card = slot.cardId === undefined ? undefined : cards.get(slot.cardId);
    const front = slotFace('front', card, order);
    const back = slotFace('back', card, order);
    const adjustments = front.adjustments ?? back.adjustments;

    useEffect(() => {
        dialog.current?.showModal();
    }, []);

    function onKeyDown(event: React.KeyboardEvent) {
        if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
        if (event.key === 'ArrowRight' && index < pack.length - 1) onIndex(index + 1);
    }

    return (
        <dialog ref={dialog} className="slot-dialog" onClose={onClose} onKeyDown={onKeyDown}>
            <header className="dialog-header">
                <div>
                    <h2>{card?.name ?? 'Blank card'}</h2>
                    <span className="meta">
                        Card {index + 1} of {pack.length} in {order.shop === 'meinspiel' ? 'pack' : 'deck'} {packNumber}
                        {adjustments ? `, brightness ${percent(adjustments.brightness)}, contrast ${percent(adjustments.contrast)}` : ''}
                    </span>
                </div>
                <div className="row">
                    <button className="quiet" aria-label="Previous card" disabled={index === 0} onClick={() => onIndex(index - 1)}><ChevronLeft/></button>
                    <button className="quiet" aria-label="Next card" disabled={index === pack.length - 1} onClick={() => onIndex(index + 1)}><ChevronRight/></button>
                    <button className="quiet" onClick={() => dialog.current?.close()}><X/>Close</button>
                </div>
            </header>
            <div className="slot-faces">
                {[front, back].map((face, i) => (
                    <figure key={i} className="proof">
                        <SlotImage face={face} order={order} status={status} label={i === 0 ? 'Front' : 'Back'}/>
                        <figcaption className="meta">{i === 0 ? 'Front' : 'Back'}{slotImage(face, order, status).done ? '' : ', not processed with these settings yet'}</figcaption>
                        {failed[face.file] && <p className="error">{failed[face.file]}</p>}
                        {face.base && status.files[face.base] !== undefined && (
                            <button className="quiet" disabled={busy} title="Downloads, post-processes and upscales this image again"
                                    onClick={() => onReprocess([face.file])}><RotateCw/>Process again</button>
                        )}
                    </figure>
                ))}
            </div>
        </dialog>
    );
}

function slotFace(side: 'front' | 'back', card: OrderCard | undefined, order: Order): Face {
    const faces = card && cardFaces(card, order);
    if (faces) return faces[side];
    return side === 'front' ? BLANK_FACE : cardBackFace(order);
}

// The base image with a CSS filter even when processed, so a change of brightness shows before the images are made anew.
function slotImage(face: Face, order: Order, status: Status): { src?: string | undefined, filter?: string, done: boolean } {
    // With the size, so an image made anew under the same name is not taken from the browser's cache.
    const preview = (file: string) => `preview://order/${encodeURIComponent(order.name)}/${encodeURIComponent(file)}?v=${status.version}-${status.files[file] ?? 0}`;
    const done = status.files[face.file] !== undefined;
    const filter = face.adjustments ? adjustmentFilter(face.adjustments) : undefined;

    const src = face.base && status.files[face.base] !== undefined ? preview(face.base)
        : face.base ? sourceImage(face)
        : done ? preview(face.file) : undefined;
    return { src, done, ...(filter ? { filter } : {}) };
}

function sourceImage(face: Face) {
    switch (face.source.type) {
        case 'scryfall':
            return faceImageUris(face.source.printing, face.source.face)?.normal;
        case 'custom':
            return `preview://image/${encodeURIComponent(face.source.image)}`;
        case 'mpcfill':
            return mpcfillImage(face.source.id, 'large');
        case 'tcg':
            return tcgPreview(face.source.card);
        default:
            return undefined;
    }
}

// Upscayl runs on the GPU; from about 90 °C on it is likely to slow down.
function GpuStatus({ stats }: { stats: GpuStats }) {
    if (stats.utilization === undefined && stats.temperature === undefined) return null;

    return (
        <p className={`status gpu${(stats.temperature ?? 0) >= 90 ? ' warning' : ''}`}>
            Upscayl on the GPU:
            {stats.utilization !== undefined && <span className="with-icon"><Gauge/>{stats.utilization} % busy</span>}
            {stats.temperature !== undefined && <span className="with-icon"><Thermometer/>{Math.round(stats.temperature)} °C</span>}
        </p>
    );
}

function describePack(pack: Slot[]) {
    const cards = pack.filter(slot => slot.cardId !== undefined).length;
    return cards === pack.length ? `${count(cards, 'card')}` : `${count(cards, 'card')} and ${count(pack.length - cards, 'blank card')}`;
}

