import { useState } from "react";

// A view setting that survives restarts. Storage can be unavailable, so it falls back to the default.
export function useStoredState<T>(key: string, fallback: T) {
    const [value, setValue] = useState<T>(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored === null ? fallback : JSON.parse(stored) as T;
        } catch {
            return fallback;
        }
    });

    function update(next: T) {
        setValue(next);
        try {
            localStorage.setItem(key, JSON.stringify(next));
        } catch {
            // The setting just does not survive a restart.
        }
    }

    return [value, update] as const;
}
