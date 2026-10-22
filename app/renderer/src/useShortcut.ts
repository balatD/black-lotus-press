import { useEffect, useRef } from "react";

const MAC = navigator.userAgent.includes('Mac');

// Cmd on macOS, Ctrl elsewhere, together with the key. Not while a dialog is open, as it would change the screen behind it.
export function useShortcut(key: string, action: () => void) {
    const latest = useRef(action);
    latest.current = action;

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            const command = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
            if (!command || event.altKey || event.key.toLowerCase() !== key) return;
            if (document.querySelector('dialog[open], [role="dialog"]')) return;
            event.preventDefault();
            latest.current();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [key]);
}
