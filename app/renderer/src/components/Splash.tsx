import { type CSSProperties, useEffect, useState } from "react";
import "./splash.css";

const SHOW_MS = 4900;
const FADE_MS = 600;

// The five frame colours of the printed cards.
const CARDS = [
    { frame: '#e8e2cf', fly: '-260px', turn: '-24deg' },
    { frame: '#2f7fc1', fly: '230px', turn: '20deg' },
    { frame: '#3b3536', fly: '-190px', turn: '-12deg' },
    { frame: '#c8452f', fly: '270px', turn: '28deg' },
    { frame: '#3f8a4e', fly: '-120px', turn: '-30deg' }
];

// The scene is drawn for 620 × 700 and scaled up to fill the window.
function sceneScale() {
    return Math.min(window.innerWidth / 620, window.innerHeight / 700, 1.6);
}

export function Splash({ onDone }: { onDone(): void }) {
    const [leaving, setLeaving] = useState(false);
    const [scale] = useState(sceneScale);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            onDone();
            return;
        }
        const leave = window.setTimeout(() => setLeaving(true), SHOW_MS);
        return () => window.clearTimeout(leave);
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
        <div className={`splash${leaving ? ' leaving' : ''}`} onClick={() => setLeaving(true)} role="presentation">
            <div className="splash-stage" style={{ scale: String(scale) }}>
                <Printer/>
                <div className="splash-output">
                    {CARDS.map((card, index) => (
                        <div key={index} className="splash-card"
                             style={{ '--frame': card.frame, '--fly': card.fly, '--turn': card.turn, '--delay': `${0.55 + index * 0.33}s` } as CSSProperties}>
                            <span className="mini-name"/>
                            <span className="mini-art"/>
                            <span className="mini-type"/>
                            <span className="mini-text"/>
                        </div>
                    ))}
                </div>
                <HeroCard/>
            </div>
            <p className="splash-hint">Click to skip</p>
        </div>
    );
}

function Printer() {
    return (
        <svg className="splash-printer" viewBox="0 0 560 320" aria-hidden="true">
            <defs>
                <linearGradient id="printer-body" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#4a4a4a"/>
                    <stop offset="1" stopColor="#2c2c2c"/>
                </linearGradient>
                <linearGradient id="printer-head" x1="0" x2="1">
                    <stop offset="0" stopColor="#00aeef" stopOpacity="0"/>
                    <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.9"/>
                    <stop offset="1" stopColor="#ec008c" stopOpacity="0"/>
                </linearGradient>
            </defs>

            {/* Input tray with a stack of blank cards. */}
            <path d="M150 70 L410 70 L440 18 L120 18 Z" fill="#2a2a2a" stroke="#555" strokeWidth="2"/>
            {[0, 1, 2, 3].map(i => <rect key={i} x={170 + i * 2} y={28 + i * 7} width={220 - i * 4} height="6" rx="2" fill={i % 2 ? '#e9e9e7' : '#d6d6d3'}/>)}

            <rect x="20" y="66" width="520" height="210" rx="26" fill="url(#printer-body)" stroke="#5c5c5c" strokeWidth="2"/>
            <rect x="34" y="78" width="492" height="14" rx="7" fill="#ffffff" opacity="0.06"/>

            {/* Print head window with a sweeping light. */}
            <rect x="120" y="108" width="320" height="58" rx="10" fill="#161616" stroke="#0e0e0e" strokeWidth="2"/>
            <rect className="printer-sweep" x="120" y="108" width="80" height="58" rx="10" fill="url(#printer-head)"/>

            {/* Control panel: process ink lights and the model plate. */}
            <rect x="462" y="112" width="58" height="50" rx="8" fill="#222"/>
            {['#00aeef', '#ec008c', '#fff200', '#e9e9e7'].map((color, i) => (
                <circle key={color} className="printer-led" cx={476 + (i % 2) * 30} cy={126 + Math.floor(i / 2) * 22} r="6" fill={color}
                        style={{ animationDelay: `${i * 0.18}s` }}/>
            ))}
            <text x="60" y="146" fill="#8a8a8a" fontSize="15" fontWeight="700" letterSpacing="2">BLP-55</text>

            {/* Output slot the cards come out of. */}
            <rect x="140" y="226" width="280" height="16" rx="8" fill="#0b0b0b"/>
            <rect x="140" y="226" width="280" height="4" rx="2" fill="#000"/>
            <rect x="60" y="276" width="40" height="18" rx="4" fill="#202020"/>
            <rect x="460" y="276" width="40" height="18" rx="4" fill="#202020"/>
        </svg>
    );
}

function HeroCard() {
    return (
        <div className="splash-hero">
            <div className="hero-frame">
                <div className="hero-title">
                    <span>Black Lotus Press</span>
                    <span className="hero-cost">0</span>
                </div>
                <div className="hero-art"><Lotus/></div>
                <div className="hero-type">Legendary Artifact — Printing Press</div>
                <div className="hero-text">
                    <p>{'{T}'}: Print 55 cards.</p>
                    <p className="hero-flavor">"Proxy them all."</p>
                </div>
                <div className="hero-pt">55/55</div>
                <span className="hero-shine"/>
            </div>
        </div>
    );
}

function Lotus() {
    const petals = [-72, -36, 0, 36, 72];
    return (
        <svg viewBox="0 0 200 140" aria-hidden="true">
            <defs>
                <radialGradient id="lotus-glow" cx="0.5" cy="0.62" r="0.6">
                    <stop offset="0" stopColor="#ec008c" stopOpacity="0.55"/>
                    <stop offset="0.45" stopColor="#00aeef" stopOpacity="0.25"/>
                    <stop offset="1" stopColor="#000" stopOpacity="0"/>
                </radialGradient>
                <linearGradient id="lotus-petal" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#5a3d6e"/>
                    <stop offset="1" stopColor="#0d0b10"/>
                </linearGradient>
            </defs>
            <rect width="200" height="140" fill="#14101a"/>
            <rect width="200" height="140" fill="url(#lotus-glow)"/>
            <g transform="translate(100 104)">
                {petals.map(angle => (
                    <path key={angle} d="M0 0 C -18 -30 -16 -62 0 -82 C 16 -62 18 -30 0 0 Z" fill="url(#lotus-petal)" stroke="#c08ad8" strokeWidth="1.2"
                          transform={`rotate(${angle})`}/>
                ))}
                <circle r="9" fill="#fff200" opacity="0.85"/>
            </g>
        </svg>
    );
}
