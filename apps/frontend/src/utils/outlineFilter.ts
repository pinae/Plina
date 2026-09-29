/** UI-7: the outline's filter, remembered per browser (§5). */
export type OutlineFilter = 'active' | 'all';

const FILTER_KEY = 'plina.outlineFilter';

export function readOutlineFilter(): OutlineFilter {
    try {
        return localStorage.getItem(FILTER_KEY) === 'all' ? 'all' : 'active';
    } catch {
        return 'active';
    }
}

export function storeOutlineFilter(filter: OutlineFilter) {
    try {
        localStorage.setItem(FILTER_KEY, filter);
    } catch {
        // Per-browser convenience only.
    }
}
