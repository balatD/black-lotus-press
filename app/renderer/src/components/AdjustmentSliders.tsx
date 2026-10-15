import { Contrast, type LucideIcon, RotateCcw, Sun } from "lucide-react";
import type { Adjustments } from "../../../../src/model.js";
import { percent } from "../adjust.js";

interface Props {
    adjustments: Adjustments;
    onChange(adjustments: Adjustments): void;
    onReset(): void;
    resetLabel: string;
    canReset: boolean;
}

export function AdjustmentSliders({ adjustments, onChange, onReset, resetLabel, canReset }: Props) {
    return (
        <div className="adjustments">
            <Slider label="Brightness" icon={Sun} value={adjustments.brightness} onChange={brightness => onChange({ ...adjustments, brightness })}/>
            <Slider label="Contrast" icon={Contrast} value={adjustments.contrast} onChange={contrast => onChange({ ...adjustments, contrast })}/>
            <button className="quiet" disabled={!canReset} onClick={onReset}><RotateCcw/>{resetLabel}</button>
        </div>
    );
}

function Slider({ label, icon: Icon, value, onChange }: { label: string, icon: LucideIcon, value: number, onChange(value: number): void }) {
    return (
        <label className="slider">
            <span className="with-icon"><Icon/>{label}</span>
            <input type="range" min={50} max={150} step={1} value={Math.round(value * 100)} onChange={e => onChange(Number(e.target.value) / 100)}/>
            <output>{percent(value)}</output>
        </label>
    );
}
