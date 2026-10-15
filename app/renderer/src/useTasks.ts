import { useEffect, useState } from "react";
import type { Task } from "../../shared/api.js";
import { api } from "./api.js";

// Tasks of the main process. They outlive the screen that started them, so screens read them from here.
export function useTasks() {
    const [tasks, setTasks] = useState<Task[]>([]);

    useEffect(() => {
        let updated = false;
        const stop = api.onTasks(current => {
            updated = true;
            setTasks(current);
        });
        void api.listTasks().then(current => updated || setTasks(current));
        return stop;
    }, []);

    return tasks;
}
