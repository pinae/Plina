import { describe, it, expect } from 'vitest';
import { applyPlacement, findItemDurationSeconds } from './planPlacement.ts';
import type { PlanResponse } from '../types.ts';

const plan: PlanResponse = {
    accepted_plan_id: 'p1',
    warnings: [],
    appointments: [
        {
            task_id: 'appt', header: 'Standup', start_time: '2026-07-08T11:00:00', duration: 1800,
            warnings: [], is_fixed: false, is_appointment: true, hex_color: null,
        },
    ],
    buckets: [
        {
            id: 'b1', start_date: '2026-07-08T09:00:00', end_date: '2026-07-08T17:00:00',
            type_name: 'Work', type_id: 1, hex_color: null, persisted: true,
            items: [
                {
                    task_id: 'moved', header: 'Move me', start_time: '2026-07-08T09:00:00', duration: 3600,
                    warnings: [], is_fixed: false, is_appointment: false, hex_color: null,
                },
                {
                    task_id: 'auto-overlap', header: 'Auto A', start_time: '2026-07-08T13:00:00', duration: 3600,
                    warnings: [], is_fixed: false, is_appointment: false, hex_color: null,
                },
                {
                    task_id: 'auto-clear', header: 'Auto B', start_time: '2026-07-08T15:00:00', duration: 3600,
                    warnings: [], is_fixed: false, is_appointment: false, hex_color: null,
                },
                {
                    task_id: 'fixed-overlap', header: 'Fixed', start_time: '2026-07-08T13:00:00', duration: 3600,
                    warnings: [], is_fixed: true, is_appointment: false, hex_color: null,
                },
            ],
        },
    ],
};

const find = (p: PlanResponse, id: string) =>
    [...p.appointments, ...p.buckets.flatMap(b => b.items)].find(i => i.task_id === id)!;

describe('findItemDurationSeconds', () => {
    it('returns the planned duration in seconds', () => {
        expect(findItemDurationSeconds(plan, 'moved')).toBe(3600);
    });
    it('returns null when the task is not planned', () => {
        expect(findItemDurationSeconds(plan, 'nope')).toBeNull();
    });
});

describe('applyPlacement', () => {
    it('pins the moved task at the new slot (is_fixed, new start/duration)', () => {
        const next = applyPlacement(plan, 'moved', '2026-07-08T13:00:00', 7200);
        const moved = find(next, 'moved');
        expect(moved.start_time).toBe('2026-07-08T13:00:00');
        expect(moved.duration).toBe(7200);
        expect(moved.is_fixed).toBe(true);
        expect(moved.outdated).toBe(false);
    });

    it('fades auto-planned tasks that overlap the new slot', () => {
        const next = applyPlacement(plan, 'moved', '2026-07-08T13:00:00', 7200); // 13:00–15:00
        expect(find(next, 'auto-overlap').outdated).toBe(true);   // 13:00–14:00 overlaps
        expect(find(next, 'auto-clear').outdated).toBeFalsy();    // 15:00–16:00 does not
    });

    it('never fades fixed tasks or appointments', () => {
        const next = applyPlacement(plan, 'moved', '2026-07-08T11:00:00', 7200); // 11:00–13:00
        expect(find(next, 'fixed-overlap').outdated).toBeFalsy();
        expect(find(next, 'appt').outdated).toBeFalsy();
    });

    it('does not mutate the original plan', () => {
        applyPlacement(plan, 'moved', '2026-07-08T13:00:00', 7200);
        expect(find(plan, 'moved').start_time).toBe('2026-07-08T09:00:00');
        expect(find(plan, 'auto-overlap').outdated).toBeUndefined();
    });
});
