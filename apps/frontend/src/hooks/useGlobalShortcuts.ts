/**
 * UI-5: single-key shortcuts (N, P, T …, docs/task-entry-ui.md §8).
 *
 * Keys are ignored while the user types (inputs, textareas, selects,
 * contenteditable), inside open dialogs, and when a modifier is held, so
 * shortcuts never swallow text or browser/OS shortcuts.
 */
import { useEffect, useRef } from 'react';

export type ShortcutMap = Partial<Record<string, () => void>>;

export function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
    return target.closest('[role="dialog"]') !== null;
}

export function useGlobalShortcuts(shortcuts: ShortcutMap): void {
    // The latest handlers without re-subscribing on every render.
    const latest = useRef(shortcuts);
    useEffect(() => {
        latest.current = shortcuts;
    });

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;
            const handler = latest.current[event.key.toLowerCase()];
            if (!handler) return;
            event.preventDefault();
            handler();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
