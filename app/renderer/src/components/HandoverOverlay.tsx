import { AppWindow, Check, Circle, CircleStop, LoaderCircle, LogIn, type LucideIcon, TriangleAlert, X } from "lucide-react";
import type { Handover, HandoverStep } from "../../../../src/model.js";

interface Props {
    handover: Handover;
    // The upload or send task is still at work.
    running: boolean;
    browserOpen: boolean;
    onShowBrowser(): void;
    onCancel(): void;
    onClose(): void;
}

const ICONS: Record<HandoverStep['state'], LucideIcon> = { pending: Circle, active: LoaderCircle, done: Check, warning: TriangleAlert, failed: X };

// The same steps as the bar over the shop's pages, for when the app is in front.
export function HandoverOverlay({ handover, running, browserOpen, onShowBrowser, onCancel, onClose }: Props) {
    const failed = handover.steps.some(step => step.state === 'failed');
    const loggingIn = running && (handover.highlight?.length ?? 0) > 0;

    return (
        <div className="handover" role="dialog" aria-labelledby="handover-title">
            <div className="handover-panel">
                <header className="dialog-header">
                    <div>
                        <h2 id="handover-title">{handover.title}</h2>
                        <span className="meta">{running ? 'In the browser window, which lies over this one.' : failed ? 'Stopped.' : 'Done.'}</span>
                    </div>
                    <button className="quiet" onClick={onClose}><X/>{running ? 'Hide' : 'Close'}</button>
                </header>
                {loggingIn && (
                    <p className="handover-callout">
                        <LogIn/>Log in in the browser window, or create an account there. Black Lotus Press carries on by itself once you are logged in.
                    </p>
                )}
                <ol className="handover-steps">
                    {handover.steps.map((step, index) => {
                        const Icon = ICONS[step.state];
                        return (
                            <li key={index} className={step.state}>
                                <Icon/>
                                <span>
                                    <span className="name">{step.label}</span>
                                    {step.detail && <span className="meta">{step.detail}</span>}
                                    {step.state === 'active' && step.progress && <progress value={step.progress.done} max={Math.max(step.progress.total, 1)} aria-label={step.label}/>}
                                </span>
                            </li>
                        );
                    })}
                </ol>
                {!running && !failed && handover.next && <p className="status">{handover.next}</p>}
                <div className="row">
                    {browserOpen && <button className="primary" onClick={onShowBrowser}><AppWindow/>Show the browser window</button>}
                    {running && <button className="quiet" onClick={onCancel}><CircleStop/>Cancel</button>}
                </div>
            </div>
        </div>
    );
}
