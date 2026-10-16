import { useEffect, useRef, useState } from "react";
import { PRESS, PRESS_SVG } from "./press/art.js";
import { PRESS_END, runPress } from "./press/motion.js";
import "./press/iso.css";
import "./press/press.css";
import "./splash.css";

const SHOW_MS = Math.round(PRESS_END * 1000) + 300;
const FADE_MS = 600;

export function Splash({ onDone }: { onDone(): void }) {
    const [leaving, setLeaving] = useState(false);
    const figure = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            onDone();
            return;
        }
        const stop = runPress(figure.current!.querySelector('svg')!, PRESS);
        const leave = window.setTimeout(() => setLeaving(true), SHOW_MS);
        return () => {
            stop();
            window.clearTimeout(leave);
        };
    }, [onDone]);

    useEffect(() => {
        if (!leaving) return;
        const done = window.setTimeout(onDone, FADE_MS);
        return () => window.clearTimeout(done);
    }, [leaving, onDone]);

    useEffect(() => {
        const skip = () => setLeaving(true);
        window.addEventListener('keydown', skip);
        return () => window.removeEventListener('keydown', skip);
    }, []);

    return (
        <div className={`splash iso${leaving ? ' leaving' : ''}`} onClick={() => setLeaving(true)} role="presentation">
            <div className="splash-figure" ref={figure} dangerouslySetInnerHTML={{ __html: PRESS_SVG }}/>
            <p className="splash-hint">Click to skip</p>
        </div>
    );
}
