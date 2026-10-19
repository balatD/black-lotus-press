import { useEffect, useState } from "react";
import type { OrderCard, ScryfallCard } from "../../../../src/model.js";
import type { MpcfillCard } from "../../../../src/clients/mpcfill.js";
import type { Recognition } from "../../../../src/mpcfill/recognise.js";
import { mpcfillImage } from "../../../../src/pipeline/packs.js";
import { api, errorMessage } from "../api.js";
import { ProgressBar } from "./ProgressBar.js";
import type { Progress } from "../useProgress.js";
import { printingsOf } from "./PrintingCandidates.js";

interface Props {
    card: OrderCard;
    face: 'front' | 'back';
    selected: string | undefined;
    large: boolean;
    // The printing is set when the image shows another printing than the card's.
    onSelect(image: MpcfillCard, printing: ScryfallCard | undefined): void;
    onUse(image: MpcfillCard, printing: ScryfallCard | undefined): void;
}

interface Found {
    printings: ScryfallCard[];
    images: MpcfillCard[];
    recognitions: Record<string, Recognition>;
}

const SCANS = 100;
const IMAGES = 50;

// Comparisons that ran to the end, so going back to a card shows its images at once.
// They do not depend on the card's printing, only on what is searched.
const finished = new Map<string, Found>();

export function mpcfillSearchKey(card: OrderCard, face: 'front' | 'back') {
    return JSON.stringify([card.name, card.isToken, card.printing?.lang, face]);
}

export function MpcfillCandidates({ card, face, selected, large, onSelect, onUse }: Props) {
    const key = mpcfillSearchKey(card, face);
    const [printings, setPrintings] = useState(() => finished.get(key)?.printings ?? []);
    const [images, setImages] = useState(() => finished.get(key)?.images);
    const [recognitions, setRecognitions] = useState(() => finished.get(key)?.recognitions ?? {});
    const [progress, setProgress] = useState<Progress>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        if (finished.has(key)) return;
        let closed = false;
        void (async () => {
            const [found, candidates] = await Promise.all([printingsOf(card), api.searchMpcfill(card, face)]);
            if (closed) return;
            setPrintings(found);
            setImages(candidates);

            const total = found.length + candidates.length;
            for (let i = 0; i < found.length && candidates.length > 0 && !closed; i += SCANS) {
                setProgress({ done: i, total, message: `Loading the Scryfall scans of ${found.length} printings` });
                await api.loadPrintingScans(face, found.slice(i, i + SCANS));
            }
            const all: Record<string, Recognition> = {};
            for (let i = 0; i < candidates.length && !closed; i += IMAGES) {
                setProgress({ done: found.length + i, total, message: `Comparing ${candidates.length} images with the printings` });
                Object.assign(all, await api.recogniseMpcfill(face, found, candidates.slice(i, i + IMAGES)));
                if (closed) return;
                setRecognitions({ ...all });
            }
            if (closed) return;
            setProgress(undefined);
            finished.set(key, { printings: found, images: candidates, recognitions: all });
        })().catch(e => !closed && setError(errorMessage(e)));
        return () => {
            closed = true;
        };
    }, [key]);

    const current = card.printing?.id;
    const recognised = (images ?? []).filter(image => recognitions[image.identifier] !== undefined);
    const shows = (image: MpcfillCard) => recognitions[image.identifier]!.printings;
    const matching = recognised.filter(image => current !== undefined && shows(image).includes(current))
        .sort((a, b) => Number(shows(b)[0] === current) - Number(shows(a)[0] === current));
    const elsewhere = recognised.filter(image => shows(image).length > 0 && (current === undefined || !shows(image).includes(current)));
    const unknown = recognised.filter(image => shows(image).length === 0);
    const printingOf = (image: MpcfillCard) => printings.find(printing => printing.id === shows(image)[0]);
    const tile = (image: MpcfillCard, printing?: ScryfallCard) => (
        <MpcfillTile key={image.identifier} image={image} printing={printing} unofficial={recognitions[image.identifier]!.unofficial} large={large}
                     isCurrent={card.mpcfill?.[face] === image.identifier} isSelected={selected === image.identifier}
                     onSelect={() => onSelect(image, printing)} onUse={() => onUse(image, printing)}/>
    );

    return (
        <>
            {error && <p className="error">{error}</p>}
            {!images && !error && <ProgressBar progress={undefined} label="Searching MPC Autofill"/>}
            {progress && !error && <ProgressBar progress={progress} label={progress.message}/>}
            {images?.length === 0 && <p className="status">MPC Autofill has no images of this card in its language.</p>}

            {images && images.length > 0 && <>
                <h3>Matches this printing ({matching.length})</h3>
                <div className="printing-grid">{matching.map(image => tile(image))}</div>

                <h3>Shows another printing ({elsewhere.length})</h3>
                <p className="status">Using one of these also changes the printing of the card.</p>
                <div className="printing-grid">{elsewhere.map(image => tile(image, printingOf(image)))}</div>

                <details>
                    <summary>Not recognised: custom art, other frames and art no printing has ({unknown.length})</summary>
                    <div className="printing-grid">{unknown.map(image => tile(image))}</div>
                </details>
            </>}
        </>
    );
}

function MpcfillTile({ image, printing, unofficial, large, isCurrent, isSelected, onSelect, onUse }: {
    image: MpcfillCard, printing: ScryfallCard | undefined, unofficial: boolean, large: boolean, isCurrent: boolean, isSelected: boolean, onSelect(): void, onUse(): void
}) {
    return (
        <button className={`printing${isCurrent ? ' current' : ''}`} aria-pressed={isSelected} title={image.name} onClick={onSelect} onDoubleClick={onUse}>
            <img src={mpcfillImage(image.identifier, large ? 'large' : 'small')} alt="" loading="lazy"/>
            {isCurrent && <span className="printing-current">Current image</span>}
            <span className="printing-set">{image.sourceName}</span>
            {printing && <span className="meta">{printing.set.toUpperCase()} #{printing.collector_number}</span>}
            <span className="badges">
                <span className="badge">{image.dpi} dpi</span>
                {unofficial && <span className="badge warning">Tagged as custom</span>}
            </span>
        </button>
    );
}
