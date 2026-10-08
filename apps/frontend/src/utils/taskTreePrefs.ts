/** T-3: the Tasks tab's view settings, remembered per browser (not synced). */
import { readRecent } from './recent.ts';

const COLLAPSED_KEY = 'plina.collapsedTasks';
const SHOW_COMPLETED_KEY = 'plina.showCompleted';

/** Collapsed parents; by default everything is expanded. */
export const readCollapsed = (): Set<string> => new Set(readRecent(COLLAPSED_KEY));

export function storeCollapsed(ids: Set<string>) {
    try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
    } catch {
        // Storage unavailable: a convenience only.
    }
}

export function readShowCompleted(): boolean {
    try {
        return localStorage.getItem(SHOW_COMPLETED_KEY) === 'true';
    } catch {
        return false;
    }
}

export function storeShowCompleted(show: boolean) {
    try {
        localStorage.setItem(SHOW_COMPLETED_KEY, String(show));
    } catch {
        // Storage unavailable: a convenience only.
    }
}

const SHOW_LINKED_KEY = 'plina.showLinkedTasks';

/** Dependency editor, filtered: also show the tasks linked to the matches
 *  (greyed). On unless turned off. */
export function readShowLinked(): boolean {
    try {
        return localStorage.getItem(SHOW_LINKED_KEY) !== 'false';
    } catch {
        return true;
    }
}

export function storeShowLinked(show: boolean) {
    try {
        localStorage.setItem(SHOW_LINKED_KEY, String(show));
    } catch {
        // Storage unavailable: a convenience only.
    }
}
