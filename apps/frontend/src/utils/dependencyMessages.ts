/**
 * Toast texts for dependencies drawn in the Tasks tab (docs/tasks-tab.md):
 * the drawing direction reads "start task depends on end task".
 */
import type { DependencyCycleError } from '../types.ts';

interface Named { id: string; header: string }

export const dependencyCreated = (from: Named, to: Named) => `“${from.header}” now depends on “${to.header}”`;

/** Why `from` cannot depend on `to`, from the server's 400 payload. */
export function dependencyRefusal(
    payload: Partial<DependencyCycleError> | undefined, from: Named, to: Named,
    headerOf: (id: string) => string | undefined,
): string {
    const pair = `“${from.header}” can’t depend on “${to.header}”`;
    const detail = [payload?.detail ?? []].flat()[0]; // DRF: ["…"]
    if (!detail) return `${pair} right now — the dependency could not be saved. Please try again.`;
    // The cycle runs [from, …, to, from]: `to` already waits for `from`.
    const chain = payload?.cycle?.slice(0, -1).map(headerOf);
    if (chain && chain.length >= 2 && chain.every(Boolean)) {
        return `${pair} — “${to.header}” already depends on “${from.header}” (${chain.join(' → ')}), `
            + 'so this would be a cycle.';
    }
    return `${pair} — ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
}
