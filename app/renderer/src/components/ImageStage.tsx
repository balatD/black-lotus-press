import { type MouseEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Maximize, Scan } from "lucide-react";
import { MPCFILL_BLEED } from "../../../../src/pipeline/packs.js";

export interface Pane {
    // Shown at once; the full image takes its place once it has loaded.
    preview: string;
    full?: string;
    // MPC Autofill images are cropped to the card, so they line up with the Scryfall scan.
    bleed: boolean;
    caption: string;
}

interface View {
    scale: number;
    // The offset of the zoomed image in fractions of the frame.
    x: number;
    y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 8;
// The full image loads a moment after the choice, so stepping through the tiles does not download every one.
const FULL_DELAY_MS = 250;

// The images side by side share the zoom, so they always show the same part of the card. The children go in front of the zoom buttons.
export function ImageStage({ panes, filter, children }: { panes: Pane[], filter: string, children: ReactNode }) {
    const stage = useRef<HTMLDivElement>(null);
    const [view, setView] = useState(FIT);
    // Pixels of the first image across the card, for 1:1.
    const [pixels, setPixels] = useState<number>();
    const drag = useRef<{ x: number, y: number }>(undefined);

    useEffect(() => {
        const element = stage.current!;
        // React listens to the wheel passively, which cannot keep the dialog from scrolling.
        function onWheel(event: WheelEvent) {
            const frame = (event.target as Element).closest('.stage-frame');
            if (!frame) return;
            event.preventDefault();
            setView(current => zoomAt(current, current.scale * Math.exp(-event.deltaY / 500), pointIn(frame, event)));
        }
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, []);

    // One image pixel on one screen pixel; images smaller than the frame have none above Fit.
    function actualScale() {
        const frame = stage.current?.querySelector('.stage-frame');
        if (!frame || !pixels) return 1;
        return Math.min(MAX_SCALE, pixels / (frame.clientWidth * window.devicePixelRatio));
    }

    function onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (view.scale === 1 || !(event.target as Element).closest('.stage-frame')) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY };
    }

    function onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const from = drag.current;
        const frame = stage.current?.querySelector('.stage-frame');
        if (!from || !frame) return;
        const [dx, dy] = [(event.clientX - from.x) / frame.clientWidth, (event.clientY - from.y) / frame.clientHeight];
        drag.current = { x: event.clientX, y: event.clientY };
        setView(current => clamp({ ...current, x: current.x + dx, y: current.y + dy }));
    }

    function onDoubleClick(event: MouseEvent) {
        const frame = (event.target as Element).closest('.stage-frame');
        if (!frame) return;
        setView(view.scale > 1 ? FIT : zoomAt(view, Math.max(2, actualScale()), pointIn(frame, event)));
    }

    const actual = actualScale();
    return (
        <div className="stage-column">
            <div className="row stage-tools">
                {children}
                <button className="quiet" disabled={view.scale === 1} onClick={() => setView(FIT)}><Maximize/>Fit</button>
                <button className="quiet" disabled={actual <= 1} title={actual <= 1 ? 'The image has fewer pixels than the screen shows at Fit' : 'One image pixel on one screen pixel'}
                        onClick={() => setView(zoomAt(view, actual, [0.5, 0.5]))}><Scan/>1:1</button>
                <span className="status">Scroll to zoom, drag to move, double-click to zoom in or out.</span>
            </div>
            <div ref={stage} className={`stage${panes.length > 1 ? ' comparing' : ''}${view.scale > 1 ? ' zoomed' : ''}`}
                 onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => drag.current = undefined} onDoubleClick={onDoubleClick}>
                {panes.map((pane, i) => (
                    <StagePane key={`${pane.preview} ${pane.full}`} pane={pane} view={view} filter={filter} onPixels={i === 0 ? setPixels : undefined}/>
                ))}
            </div>
        </div>
    );
}

function StagePane({ pane, view, filter, onPixels }: { pane: Pane, view: View, filter: string, onPixels: ((pixels: number) => void) | undefined }) {
    const [full, setFull] = useState<'waiting' | 'loading' | 'loaded' | 'failed'>('waiting');
    const [size, setSize] = useState<[number, number]>();

    useEffect(() => {
        if (!pane.full) return;
        const timer = setTimeout(() => setFull('loading'), FULL_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);

    function loaded(image: HTMLImageElement) {
        setSize([image.naturalWidth, image.naturalHeight]);
        onPixels?.(image.naturalWidth * (pane.bleed ? 1 - 2 * MPCFILL_BLEED.x : 1));
    }

    const style = { filter, ...(pane.bleed ? BLEED_CROP : {}) };
    const state = full === 'loading' ? ', loading the full image…' : full === 'failed' ? '; the full image could not be loaded, this is a smaller preview' : '';
    return (
        <figure className="stage-pane">
            <div className="stage-frame">
                <div className="stage-content" style={{ transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.scale})` }}>
                    <img src={pane.preview} alt="" style={style} onLoad={e => full !== 'loaded' && loaded(e.currentTarget)}/>
                    {(full === 'loading' || full === 'loaded') && (
                        <img className={full} src={pane.full} alt="" style={style}
                             onLoad={e => {
                                 setFull('loaded');
                                 loaded(e.currentTarget);
                             }}
                             onError={() => setFull('failed')}/>
                    )}
                </div>
            </div>
            <figcaption className="meta">{pane.caption}{size ? ` · ${size[0]} × ${size[1]} px` : ''}{state}</figcaption>
        </figure>
    );
}

// Places the card inside the bleed exactly on the frame.
const BLEED_CROP = {
    left: `${-MPCFILL_BLEED.x / (1 - 2 * MPCFILL_BLEED.x) * 100}%`,
    top: `${-MPCFILL_BLEED.y / (1 - 2 * MPCFILL_BLEED.y) * 100}%`,
    width: `${100 / (1 - 2 * MPCFILL_BLEED.x)}%`,
    height: `${100 / (1 - 2 * MPCFILL_BLEED.y)}%`
};

function clamp({ scale, x, y }: View): View {
    const limit = (offset: number) => Math.min(0, Math.max(1 - scale, offset));
    return { scale, x: limit(x), y: limit(y) };
}

// Zooms so the point of the frame, in fractions of it, stays in place.
function zoomAt(view: View, to: number, [px, py]: [number, number]): View {
    const scale = Math.min(MAX_SCALE, Math.max(1, to));
    return clamp({ scale, x: px - (px - view.x) * scale / view.scale, y: py - (py - view.y) * scale / view.scale });
}

function pointIn(frame: Element, event: { clientX: number, clientY: number }): [number, number] {
    const rect = frame.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
}
