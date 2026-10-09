import { describe, expect, it } from 'vitest';

import { makeTask } from '../testing/treeFixtures.ts';
import type { Dependency, PlanItem, PlanResponse, Task } from '../types.ts';
import { lightPlan, needsReplan } from './lightPlan.ts';

// Local times: the plan's days are the user's days.
const at = (hour: number, minute = 0, day = 8) => new Date(2026, 9, day, hour, minute);
const iso = (hour: number, minute = 0, day = 8) => at(hour, minute, day).toISOString();

const item = (taskId: string, start: Date, hours: number, over: Partial<PlanItem> = {}): PlanItem => ({
    task_id: taskId, header: taskId, start_time: start.toISOString(), duration: hours * 3600, warnings: [],
    is_fixed: false, is_appointment: false, hex_color: null, ...over,
});

const bucket = (id: string, from: Date, to: Date, items: PlanItem[]) => ({
    id, start_date: from.toISOString(), end_date: to.toISOString(), type_name: 'Work', type_id: 1,
    hex_color: null, persisted: true, items,
});

/** Today 9–17: A 9–10, B 10–12, C 12–13; tomorrow 9–17: D 9–11. */
const plan = (): PlanResponse => ({
    accepted_plan_id: 'p1', warnings: [], appointments: [],
    buckets: [
        bucket('today', at(9), at(17), [item('A', at(9), 1), item('B', at(10), 2), item('C', at(12), 1)]),
        bucket('tomorrow', at(9, 0, 9), at(17, 0, 9), [item('D', at(9, 0, 9), 2)]),
    ],
});
const baseTasks = (): Task[] => [
    makeTask('A', { duration: '01:00:00' }), makeTask('B', { duration: '02:00:00' }),
    makeTask('C', { duration: '01:00:00' }), makeTask('D', { duration: '02:00:00' }),
];

function shown(tasks: Task[], now: Date, dependencies: Dependency[] = [], source = plan()) {
    const result = lightPlan(source, { tasks, dependencies, now, defaultMinutes: 60 });
    const items = [...result.plan.appointments, ...result.plan.buckets.flatMap(b => b.items)];
    const time = (date: Date) => `${date.getDate() === 8 ? '' : `${date.getDate()}. `}${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    return {
        slots: items.map(i => {
            const start = new Date(i.start_time);
            return `${i.header} ${time(start)}–${time(new Date(start.getTime() + i.duration * 1000))}`;
        }).sort((a, b) => a.localeCompare(b)),
        notes: result.notes,
        result,
    };
}
const edit = (tasks: Task[], id: string, over: Partial<Task>) => tasks.map(t => (t.id === id ? { ...t, ...over } : t));

describe('lightPlan', () => {
    it('shows an unchanged plan as it is', () => {
        const { slots, notes } = shown(baseTasks(), at(8));
        expect(slots).toEqual(['A 9:00–10:00', 'B 10:00–12:00', 'C 12:00–13:00', 'D 9. 9:00–9. 11:00']);
        expect(needsReplan(notes)).toBe(false);
    });

    it('pulls the next tasks forward when one is done early', () => {
        const tasks = edit(baseTasks(), 'A', { is_done: true, completed_at: iso(9, 40), time_spent: '00:40:00' });
        expect(shown(tasks, at(9, 40)).slots).toEqual(['A 9:00–9:40', 'B 9:40–11:40', 'C 11:40–12:40', 'D 9. 9:00–9. 11:00']);
    });

    it('moves later tasks along while the tracked one runs over', () => {
        const tasks = edit(baseTasks(), 'A', { is_fixed: true, start_date: iso(9), active_tracking_start: iso(9) });
        expect(shown(tasks, at(10, 30)).slots)
            .toEqual(['A 9:00–10:30', 'B 10:30–12:30', 'C 12:30–13:30', 'D 9. 9:00–9. 11:00']);
    });

    it('shows a tracked task as running also when it is not pinned', () => {
        const tasks = edit(baseTasks(), 'C', { active_tracking_start: iso(9) });
        const { slots } = shown(tasks, at(9, 30));
        expect(slots).toContain('C 9:00–9:30');
        expect(slots).toContain('A 9:30–10:30');
    });

    it('keeps what is left of a tracked task where it is planned', () => {
        // B was started early, at 9:00 instead of A, and is being worked on.
        const tasks = edit(baseTasks(), 'B', { is_fixed: true, start_date: iso(9), active_tracking_start: iso(9) });
        expect(shown(tasks, at(9, 30)).slots)
            .toEqual(['A 9:30–10:30', 'B 10:30–12:00', 'B 9:00–9:30', 'C 12:00–13:00', 'D 9. 9:00–9. 11:00']);
    });

    it('brings a slice missed earlier today back at now, first', () => {
        expect(shown(baseTasks(), at(11)).slots)
            .toEqual(['A 11:00–12:00', 'B 12:00–14:00', 'C 14:00–15:00', 'D 9. 9:00–9. 11:00']);
    });

    it('lets a bigger estimate push the rest; what no longer fits the day is listed, not moved', () => {
        const tasks = edit(baseTasks(), 'B', { duration: '07:00:00' });
        const { slots, notes } = shown(tasks, at(8));
        expect(slots).toEqual(['A 9:00–10:00', 'B 10:00–17:00', 'D 9. 9:00–9. 11:00']);
        expect(notes.overflow).toEqual([{ taskId: 'C', header: 'C', minutes: 60 }]);
        expect(needsReplan(notes)).toBe(true);
    });

    it('shrinks a task by the time already spent on it', () => {
        const tasks = edit(baseTasks(), 'B', { time_spent: '01:30:00' });
        expect(shown(tasks, at(8)).slots).toEqual(['A 9:00–10:00', 'B 10:00–10:30', 'C 10:30–11:30', 'D 9. 9:00–9. 11:00']);
    });

    it('shows appointments from the tasks and plans around them', () => {
        const tasks = [...baseTasks(), makeTask('Call', { is_appointment: true, start_date: iso(10, 30), duration: '00:30:00' })];
        expect(shown(tasks, at(8)).slots)
            .toEqual(['A 9:00–10:00', 'B 10:00–10:30', 'B 11:00–12:30', 'C 12:30–13:30', 'Call 10:30–11:00', 'D 9. 9:00–9. 11:00']);
    });

    it('keeps a pinned task where it was put; its time come and not started, it goes on from now', () => {
        const pinned = edit(baseTasks(), 'B', { is_fixed: true, start_date: iso(14) });
        expect(shown(pinned, at(8)).slots).toEqual(['A 9:00–10:00', 'B 14:00–16:00', 'C 10:00–11:00', 'D 9. 9:00–9. 11:00']);
        // At 14:30 nothing of today has happened: all of it from now on, in
        // the planned order; what is past the bucket's end is listed.
        const late = shown(pinned, at(14, 30));
        expect(late.slots).toEqual(['A 14:30–15:30', 'B 15:30–17:00', 'D 9. 9:00–9. 11:00']);
        expect(late.notes.overflow).toEqual([{ taskId: 'B', header: 'B', minutes: 30 }, { taskId: 'C', header: 'C', minutes: 60 }]);
        // Without any planned slice (new since the plan): from now on, too.
        const added = [...baseTasks(), makeTask('E', { is_fixed: true, start_date: iso(8) })];
        expect(shown(added, at(8, 30)).slots).toContain('E 8:30–9:30');
    });

    it('keeps the planned slices of a task tracked for a moment and stopped', () => {
        // D (planned tomorrow) was started today at 8:00 and stopped at 8:10:
        // tracking pinned it there, but the rest stays tomorrow.
        const tasks = edit(baseTasks(), 'D', { is_fixed: true, start_date: iso(8), time_spent: '00:10:00' });
        expect(shown(tasks, at(8, 10)).slots).toContain('D 9. 9:00–9. 10:50');
    });

    it('starts no task before its predecessors (or their subtrees) are done', () => {
        const pinned = edit(baseTasks(), 'B', { is_fixed: true, start_date: iso(14) });
        const dependencies = [{ id: 'd', predecessor: 'B', successor: 'C' }];
        expect(shown(pinned, at(8), dependencies).slots).toContain('C 16:00–17:00');
    });

    it('shows an unplanned appointment as a reminder that blocks nothing (README: Unplanned appointments)', () => {
        const defense = makeTask('Defense', {
            is_appointment: true, is_unplanned: true, start_date: iso(10), duration: '02:00:00',
        });
        // Even with an entry from a plan made before it was unplanned.
        const source = plan();
        source.appointments.push(item('Defense', at(10), 2, { is_appointment: true }));
        const { slots, result } = shown([...baseTasks(), defense], at(8), [], source);
        expect(slots).toEqual(['A 9:00–10:00', 'B 10:00–12:00', 'C 12:00–13:00', 'D 9. 9:00–9. 11:00', 'Defense 10:00–12:00']);
        expect(result.plan.appointments.find(i => i.task_id === 'Defense')?.is_unplanned).toBe(true);
    });

    it('drops deleted tasks and lists work whose days are over', () => {
        const yesterday = plan();
        yesterday.buckets[0].items.push(item('Old', at(9, 0, 7), 1));
        const tasks = [...baseTasks().filter(t => t.id !== 'C'), makeTask('Old')];
        const { slots, notes } = shown(tasks, at(8), [], yesterday);
        expect(slots.some(slot => slot.startsWith('C '))).toBe(false);
        expect(slots).toContain('Old 7. 9:00–7. 10:00'); // history stays
        expect(notes.dropped).toEqual([{ taskId: 'Old', header: 'Old', minutes: 60 }]);
    });
});
