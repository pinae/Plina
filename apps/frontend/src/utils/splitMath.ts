/**
 * UI-6: how the numbers of the split editor add up (docs/task-entry-ui.md §4.3).
 *
 * The parent's estimate is a budget. Rows with a typed duration are explicit;
 * rows without one show a *ghost* — the not-yet-assigned time shared equally,
 * in 15-minute steps that still add up exactly. Indented rows split their
 * row's budget the same way.
 */
import { toTree, type OutlineNode, type OutlineRow } from './outline.ts';

const STEP = 15;

export interface GhostResult {
    minutes: number[];
    ghost: boolean[];
    /** Nothing was left for the ghosts: they show the default duration. */
    overflow: boolean;
}

export function ghostDurations(available: number, explicit: (number | null)[], defaultMinutes: number): GhostResult {
    const ghost = explicit.map(m => m === null);
    const count = ghost.filter(Boolean).length;
    const unassigned = available - explicit.reduce<number>((sum, m) => sum + (m ?? 0), 0);
    let shares: number[] = [];
    let overflow = false;
    if (count > 0) {
        if (unassigned <= 0) {
            overflow = true;
            shares = Array(count).fill(defaultMinutes);
        } else if (unassigned < STEP * count) {
            shares = Array(count).fill(STEP);
        } else {
            const base = Math.floor(unassigned / STEP / count) * STEP;
            shares = Array(count).fill(base);
            let remainder = unassigned - base * count;
            for (let i = 0; remainder >= STEP; i = (i + 1) % count, remainder -= STEP) shares[i] += STEP;
            shares[0] += remainder; // below one step: keep the sum exact
        }
    }
    let next = 0;
    return { minutes: explicit.map(m => m ?? shares[next++]), ghost, overflow };
}

export interface RowBudget {
    minutes: number;
    ghost: boolean;
    /** Sub-parts add up to more than this row. */
    overBy?: number;
}

/** Minutes per row (by key): explicit, or a ghost share of its level. */
export function computeBudgets(rows: OutlineRow[], available: number, defaultMinutes: number): Map<string, RowBudget> {
    const budgets = new Map<string, RowBudget>();
    const level = (nodes: OutlineNode[], budget: number) => {
        const result = ghostDurations(budget, nodes.map(n => n.row.minutes), defaultMinutes);
        nodes.forEach((node, i) => {
            const own: RowBudget = { minutes: result.minutes[i], ghost: result.ghost[i] };
            if (node.children.length > 0) {
                const parts = node.children.reduce((sum, c) => sum + (c.row.minutes ?? 0), 0);
                if (parts > own.minutes) own.overBy = parts - own.minutes;
                level(node.children, own.minutes);
            }
            budgets.set(node.row.key, own);
        });
    };
    level(toTree(rows), available);
    return budgets;
}

export interface Segment {
    kind: 'spent' | 'explicit' | 'ghost' | 'unassigned' | 'over';
    minutes: number;
    label?: string;
}

export interface Allocation {
    segments: Segment[];
    /** Estimate minus time already spent on the parent. */
    available: number;
    /** Σ of the top-level rows (ghosts included). */
    partsTotal: number;
    unassigned: number;
    overBy: number;
}

/** The allocation bar: spent time, top-level parts in order, then the
 *  unassigned rest (hatched) or the overflow (red). */
export function allocation(estimate: number, spent: number, rows: OutlineRow[],
                           budgets: Map<string, RowBudget>): Allocation {
    const available = Math.max(0, estimate - spent);
    const top = rows.filter(r => r.depth === 0);
    const segments: Segment[] = spent > 0 ? [{ kind: 'spent', minutes: spent, label: 'spent' }] : [];
    let partsTotal = 0;
    for (const r of top) {
        const budget = budgets.get(r.key);
        if (!budget) continue;
        partsTotal += budget.minutes;
        segments.push({ kind: budget.ghost ? 'ghost' : 'explicit', minutes: budget.minutes, label: r.header });
    }
    const unassigned = Math.max(0, available - partsTotal);
    const overBy = Math.max(0, partsTotal - available);
    if (unassigned > 0) segments.push({ kind: 'unassigned', minutes: unassigned });
    if (overBy > 0) segments.push({ kind: 'over', minutes: overBy });
    return { segments, available, partsTotal, unassigned, overBy };
}
