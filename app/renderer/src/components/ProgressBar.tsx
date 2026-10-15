import type { Progress } from "../useProgress.js";

// Without a total the bar keeps running, for steps that cannot be counted.
export function ProgressBar({ progress, label }: { progress: Progress | undefined, label: string }) {
    const message = progress?.message ?? label;
    const counted = progress && progress.total > 0 ? progress : undefined;
    return (
        <div className="progress">
            <progress value={counted?.done} max={counted?.total ?? 1} aria-label={message}/>
            <span className="status">{counted ? `${message} (${counted.done} of ${counted.total})` : message}</span>
        </div>
    );
}
