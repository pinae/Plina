import { describe, expect, it } from 'vitest';
import { allocation, computeBudgets, ghostDurations } from './splitMath.ts';
import { newRow, type OutlineRow } from './outline.ts';

const row = (header: string, minutes: number | null, depth = 0): OutlineRow =>
    ({ ...newRow(depth), key: header, header, minutes });

describe('ghostDurations', () => {
    it('shares the rest in 15-minute steps that add up exactly (spec scenario 3)', () => {
        const result = ghostDurations(720, [null, null, null, null, null], 60);
        expect(result.minutes).toEqual([150, 150, 150, 135, 135]);
        expect(result.minutes.reduce((a, b) => a + b)).toBe(720);
        expect(result.ghost).toEqual([true, true, true, true, true]);
    });

    it('rebalances the ghosts when a row becomes explicit', () => {
        expect(ghostDurations(720, [180, null, null, null, null], 60).minutes).toEqual([180, 135, 135, 135, 135]);
    });

    it('gives a remainder below 15 minutes to the first ghost', () => {
        expect(ghostDurations(100, [null, null], 60).minutes).toEqual([55, 45]);
    });

    it('falls back to the default duration when nothing is left', () => {
        const result = ghostDurations(120, [120, null], 45);
        expect(result.minutes).toEqual([120, 45]);
        expect(result.overflow).toBe(true);
    });

    it('never makes a ghost shorter than 15 minutes', () => {
        expect(ghostDurations(20, [null, null], 60).minutes).toEqual([15, 15]);
    });
});

describe('computeBudgets', () => {
    it('lets indented rows split their row’s share', () => {
        const rows = [row('CAD', null), row('housing', null, 1), row('mount', 60, 1), row('prints', 240)];
        const budgets = computeBudgets(rows, 600, 60);
        expect(budgets.get('CAD')).toEqual({ minutes: 360, ghost: true });
        expect(budgets.get('housing')).toEqual({ minutes: 300, ghost: true });
        expect(budgets.get('mount')).toEqual({ minutes: 60, ghost: false });
        expect(budgets.get('prints')).toEqual({ minutes: 240, ghost: false });
    });

    it('reports rows whose sub-parts exceed them', () => {
        const rows = [row('CAD', 60), row('housing', 90, 1)];
        expect(computeBudgets(rows, 600, 60).get('CAD')?.overBy).toBe(30);
    });
});

describe('allocation', () => {
    it('lays out spent time, parts, ghosts and the unassigned rest', () => {
        const rows = [row('CAD', 180), row('prints', null)];
        const budgets = computeBudgets(rows, 600, 60);
        const result = allocation(720, 120, rows, budgets);
        expect(result.segments.map(s => [s.kind, s.minutes])).toEqual([
            ['spent', 120], ['explicit', 180], ['ghost', 420],
        ]);
        expect(result).toMatchObject({ partsTotal: 600, available: 600, unassigned: 0, overBy: 0 });
    });

    it('shows the unassigned rest when every row is explicit', () => {
        const rows = [row('CAD', 180)];
        const result = allocation(240, 0, rows, computeBudgets(rows, 240, 60));
        expect(result.segments.at(-1)).toMatchObject({ kind: 'unassigned', minutes: 60 });
    });

    it('shows how far the parts exceed the estimate', () => {
        const rows = [row('a', 180), row('b', 135), row('c', 135), row('d', 135), row('assembly', 240)];
        const result = allocation(720, 0, rows, computeBudgets(rows, 720, 60));
        expect(result.overBy).toBe(105); // 1h 45m (spec scenario 3)
        expect(result.partsTotal).toBe(825);
        expect(result.segments.at(-1)).toMatchObject({ kind: 'over', minutes: 105 });
    });
});
