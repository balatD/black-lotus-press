import { useState } from "react";
import { AppWindow, CircleStop, CloudUpload, Download, FileText, Images, type LucideIcon, WandSparkles, X } from "lucide-react";
import type { Task } from "../../../shared/api.js";
import { api } from "../api.js";
import { useProgress } from "../useProgress.js";
import { useTasks } from "../useTasks.js";
import { ProgressBar } from "./ProgressBar.js";

const ICONS: Record<Task['kind'], LucideIcon> = {
    import: Download,
    process: WandSparkles,
    pdfs: FileText,
    upload: CloudUpload,
    upscayl: Download,
    mpcfill: Images,
    browser: AppWindow
};

export function Tasks() {
    const tasks = useTasks();
    if (tasks.length === 0) return null;

    return (
        <section className="tasks" aria-label="Running tasks">
            <h2>Running</h2>
            <ul className="rail-list">
                {tasks.map(task => <TaskItem key={task.id} task={task}/>)}
            </ul>
        </section>
    );
}

function TaskItem({ task }: { task: Task }) {
    const browser = task.kind === 'browser';
    const progress = useProgress(!browser);
    const [stopping, setStopping] = useState(false);
    const Icon = ICONS[task.kind];

    function stop() {
        setStopping(true);
        void api.stopTask(task.id);
    }

    return (
        <li className="task">
            <span className="with-icon"><Icon/>{task.title}</span>
            {!browser && <ProgressBar progress={progress} label="Starting"/>}
            {task.stoppable && <button className="quiet" disabled={stopping} onClick={stop}>{browser ? <><X/>Close browser</> : <><CircleStop/>Cancel</>}</button>}
        </li>
    );
}
