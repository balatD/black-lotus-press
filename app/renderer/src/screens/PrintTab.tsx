import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
    AppWindow, Check, ChevronLeft, ChevronRight, CircleStop, CloudUpload, ExternalLink, FileText, FolderOpen, Gauge, Image as ImageIcon,
    Maximize2, Package, RectangleVertical, RotateCw, Sun, Thermometer, WandSparkles, X, ZoomIn, ZoomOut
} from "lucide-react";
import { DEFAULT_ADJUSTMENTS, type GpuStats, type Order, type OrderCard, type PackFiles } from "../../../../src/model.js";
import {
    BLANK_FACE,
    buildPacks,
    cardBackFace,
    cardFaces,
    CARDS_PER_PACK,
    estimatePackBytes,
    type Face,
    faceImageUris,
    MAX_UPLOAD_BYTES,
    type Slot
} from "../../../../src/pipeline/packs.js";
import { adjustmentFilter, percent } from "../adjust.js";
import { AdjustmentSliders } from "../components/AdjustmentSliders.js";
import { useStoredState } from "../useStoredState.js";
import { api, errorMessage, wasStopped } from "../api.js";
import { count, describeProcessing, formatMegabytes } from "../format.js";
import { ColorBar, RegistrationMark } from "../components/Decor.js";
import { useProgress } from "../useProgress.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { useTasks } from "../useTasks.js";
import { useGpuStats } from "../useGpuStats.js";

export interface BuiltPdfs {
    // The packs and image settings the PDFs were built from.
    key: string;
    packs: PackFiles[];
}

interface Props {
    order: Order;
    update(change: (order: Order) => Order): void;
    onFlush(): Promise<void>;
    built: BuiltPdfs | undefined;
    onBuilt(built: BuiltPdfs): void;
}

type Status = { version: string, files: Record<string, number> };

const MEINSPIEL_ACCOUNT = 'https://www.meinspiel.de/mein-konto';

const ZOOM_MIN = 70;
const ZOOM_MAX = 320;
const ZOOM_STEP = 30;

export function PrintTab({ order, update, onFlush, built, onBuilt }: Props) {
    const [status, setStatus] = useState<Status>({ version: '', files: {} });
    // 0 fits the sheet to the window.
    const [zoom, setZoom] = useStoredState('print-zoom', 0);
    const [opened, setOpened] = useState<number>();
    const [error, setError] = useState<string>();
    const [packIndex, setPackIndex] = useState(0);
    const [side, setSide] = useState<'front' | 'back'>('front');
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
        if (event.type === 'face-ready') setStatus(current => ({ ...current, files: { ...current.files, [event.file]: event.bytes } }));
    }), []);

    const { packs, droppedTokens } = buildPacks(order);
    const cards = new Map(order.cards.map(card => [card.id, card]));
    const needed = new Set(packs.flat().flatMap(slot => [slot.front, slot.back]));
    const processed = [...needed].filter(file => status.files[file] !== undefined).length;
    const allProcessed = needed.size > 0 && processed === needed.size;
    const pdfKey = JSON.stringify([status.version, packs]);
    const pdfs = built?.key === pdfKey ? built.packs : undefined;
    const tooBig = pdfs?.some(pack => pack.bytes > MAX_UPLOAD_BYTES) ?? false;

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
    const buildPdfs = () => run(() => api.buildPdfs(order), result => onBuilt({ key: pdfKey, packs: result.packs }));
    const upload = () => {
        if (!pdfs || !window.confirm('Upload the PDFs to meinspiel.de? This confirms that you followed their design and PDF guidelines.')) return;
        void run(() => api.uploadPacks(order.name, pdfs, order.profile.playwrightChannel),
            games => update(current => ({ ...current, uploaded: { at: new Date().toISOString(), games } })));
    };

    if (packs.length === 0) {
        return (
            <div className="empty">
                <h2>Nothing to print yet</h2>
                <p>Import the decks on the Setup tab first.</p>
            </div>
        );
    }

    const pack = packs[Math.min(packIndex, packs.length - 1)]!;

    return (
        <div className="print">
            <ol className="steps">
                <li>
                    <h2><WandSparkles/>Process the card images</h2>
                    <p className="muted">{processed} of {needed.size} images are ready ({describeProcessing(order.profile)}).</p>
                    <div className="row">
                        <button className="primary" disabled={running !== undefined || allProcessed} onClick={() => void processImages()}>
                            {allProcessed ? <><Check/>All images are ready</> : <><WandSparkles/>Process images</>}
                        </button>
                        {job?.kind === 'process' && <button className="quiet" onClick={() => void api.stopTask(job.id)}><CircleStop/>Cancel</button>}
                        {job?.kind !== 'process' && processed > 0 && (
                            <button className="quiet" disabled={running !== undefined} onClick={reprocessAll}><RotateCw/>Process all again</button>
                        )}
                    </div>
                    {job?.kind === 'process' && <ProgressBar progress={progress} label="Processing card images"/>}
                    {gpu && <GpuStatus stats={gpu}/>}
                </li>
                <li>
                    <h2><FileText/>Build the PDFs</h2>
                    <p className="muted">Two PDFs per pack: all fronts and all backs, 55 pages each.</p>
                    <div className="row">
                        <button className={allProcessed && !pdfs ? 'primary' : ''} disabled={running !== undefined || !allProcessed} onClick={() => void buildPdfs()}><FileText/>Build PDFs</button>
                        <button className="quiet" onClick={() => void api.openOrderFolder(order)}><FolderOpen/>Open order folder</button>
                    </div>
                    {job?.kind === 'pdfs' && <ProgressBar progress={progress} label="Writing the PDFs"/>}
                    {pdfs && (
                        <ul className="files">
                            {pdfs.map((files, index) => (
                                <li key={files.fronts} className={files.bytes > MAX_UPLOAD_BYTES ? 'error' : ''}>
                                    Pack {index + 1}: {formatMegabytes(files.bytes)}{files.bytes > MAX_UPLOAD_BYTES ? ', over the 200 MB upload limit. Lower the resolution in the profile.' : ''}
                                </li>
                            ))}
                        </ul>
                    )}
                </li>
                <li>
                    <h2><CloudUpload/>Upload to meinspiel.de</h2>
                    <p className="muted">Log in when the browser opens. Every pack becomes a game in your account; you choose the box and order there yourself.</p>
                    <div className="row">
                        <button className={pdfs && !tooBig && !order.uploaded ? 'primary' : ''} disabled={running !== undefined || !pdfs || tooBig} onClick={upload}><CloudUpload/>Upload</button>
                        {job?.kind === 'upload' && <button className="quiet" onClick={() => void api.stopTask(job.id)}><CircleStop/>Cancel</button>}
                        {browser && <button className="quiet" onClick={() => void api.stopTask(browser.id)}><AppWindow/>Close browser</button>}
                    </div>
                    {job?.kind === 'upload' && <ProgressBar progress={progress} label="Opening the browser"/>}
                    {order.uploaded && (
                        <>
                            <ul className="files">
                                {order.uploaded.games.map(game => (
                                    <li key={game.id} className={game.saved ? '' : 'warning'}>
                                        <a href={game.url} target="_blank" rel="noreferrer">{game.name}<ExternalLink/></a>
                                        : {game.saved ? 'saved in your account' : 'not saved in your account. Click "Speichern" in its tab of the upload browser.'}
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
            </ol>

            {error && <p className="error" role="alert" style={{ whiteSpace: 'pre-line' }}>{error}</p>}

            <section className="adjust-section">
                <h2><Sun/>Brightness and contrast</h2>
                <AdjustmentSliders
                    adjustments={order.adjustments}
                    onChange={adjustments => update(current => ({ ...current, adjustments }))}
                    onReset={() => update(current => ({ ...current, adjustments: DEFAULT_ADJUSTMENTS }))}
                    resetLabel={`Back to ${percent(DEFAULT_ADJUSTMENTS.brightness)} and ${percent(DEFAULT_ADJUSTMENTS.contrast)}`}
                    canReset={order.adjustments.brightness !== DEFAULT_ADJUSTMENTS.brightness || order.adjustments.contrast !== DEFAULT_ADJUSTMENTS.contrast}/>
                <p className="status">
                    For every card of this order; single cards can get their own on top in the Cards tab. Print comes out darker than the screen,
                    which is why it starts at {percent(DEFAULT_ADJUSTMENTS.brightness)}. The sheet below shows changes right away. Process the images afterwards:
                    that only takes seconds, because the upscaled images are kept.
                </p>
            </section>

            <section className="sheet-section">
                <div className="row">
                    <div className="tabs" role="tablist" aria-label="Pack">
                        {packs.map((_, index) => (
                            <button key={index} role="tab" aria-selected={index === packIndex} onClick={() => setPackIndex(index)}><Package/>Pack {index + 1}</button>
                        ))}
                    </div>
                    <div className="tabs" role="tablist" aria-label="Side">
                        <button role="tab" aria-selected={side === 'front'} onClick={() => setSide('front')}><ImageIcon/>Fronts</button>
                        <button role="tab" aria-selected={side === 'back'} onClick={() => setSide('back')}><RectangleVertical/>Backs</button>
                    </div>
                    <span className="status grow" style={{ textAlign: 'right' }}>
                        {describePack(pack)}{allProcessed ? `, about ${formatMegabytes(estimatePackBytes(pack, status.files))}` : ''}. Approximate print preview, click a card to see it large.
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
                                       onOpen={() => setOpened(index)}/>
                        ))}
                    </ol>
                    <p className="slug">
                        <span>meinspiel.de</span>
                        <span>{order.name}</span>
                        <span>Pack {packIndex + 1} of {packs.length}</span>
                        <span>{side === 'front' ? 'Fronts' : 'Backs'}</span>
                        <span>69 × 94 mm with 3 mm bleed</span>
                        <span>{order.profile.postProcessing.dpi} dpi</span>
                        <span>ISO Coated v2 300% (ECI)</span>
                    </p>
                </div>
                </div>
                {opened !== undefined && (
                    <SlotDialog pack={pack} packNumber={packIndex + 1} index={opened} cards={cards} order={order} status={status}
                                busy={running !== undefined} onReprocess={files => void reprocess(files)}
                                onIndex={setOpened} onClose={() => setOpened(undefined)}/>
                )}
                {droppedTokens.length > 0 && (
                    <p className="muted">Not in any pack because they would need another one: {droppedTokens.map(token => token.copies > 1 ? `${token.card.name} ×${token.copies}` : token.card.name).join(', ')}.</p>
                )}
            </section>
        </div>
    );
}

interface SlotProps {
    side: 'front' | 'back';
    card: OrderCard | undefined;
    order: Order;
    status: Status;
}

function SheetSlot({ side, card, order, status, onOpen }: SlotProps & { onOpen(): void }) {
    const face = slotFace(side, card, order);
    const label = card ? `${card.name}${side === 'back' && face.source.type === 'cardback' ? ' (card back)' : ''}` : 'Blank card';

    return (
        <li className={`slot${card ? '' : ' blank'}`}>
            <button className="slot-button" title={label} onClick={onOpen}>
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

function SlotDialog({ pack, packNumber, index, cards, order, status, busy, onReprocess, onIndex, onClose }: {
    pack: Slot[], packNumber: number, index: number, cards: Map<string, OrderCard>, order: Order, status: Status, busy: boolean,
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
                        Card {index + 1} of {pack.length} in pack {packNumber}
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

// The base image with a CSS filter even when processed: the CMYK print images, read back without
// meinspiel's ICC profile, look too dark and hide the brightness.
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
    return cards === CARDS_PER_PACK ? `${count(cards, 'card')}` : `${count(cards, 'card')} and ${count(CARDS_PER_PACK - cards, 'blank card')}`;
}

