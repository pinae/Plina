/** Recently used ids per browser (localStorage): a convenience for pickers
 *  and quick-add chips, not synced across devices. Storage can be missing
 *  (private mode) or hold garbage, so every access is guarded. */
export const RECENT_PROJECTS = 'plina.recentProjects';
export const RECENT_TAGS = 'plina.recentTags';

export function readRecent(key: string): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

export function rememberRecent(key: string, id: string, max = 5) {
    try {
        const next = [id, ...readRecent(key).filter(r => r !== id)].slice(0, max);
        localStorage.setItem(key, JSON.stringify(next));
    } catch {
        // Storage unavailable: recents are optional.
    }
}
