import { describe, expect, it } from 'vitest';
import type { PlanResponse, Task } from '../types.ts';
import { isInside, nextPlannedItem, projectFor, projectOptions, trackedTask } from './projects.ts';
import { treeDefaults } from '../testing/treeFixtures.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
    id, header: id, description: '', start_date: null, duration: '01:00:00',
    latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null,
    is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
    active_tracking_start: null, ...treeDefaults, ...over,
});

// T250 › Hardware Design › CAD ; T250 › Firmware ; Blog › Article ; Milk ; Old (done)
const tasks: Task[] = [
    task('T250', { priority: 9, children_ids: ['HW', 'FW'] }),
    task('HW', { header: 'Hardware Design', parent_id: 'T250', children_ids: ['CAD'], ancestor_ids: ['T250'] }),
    task('CAD', { parent_id: 'HW', ancestor_ids: ['T250', 'HW'] }),
    task('FW', { header: 'Firmware', parent_id: 'T250', order: 1, ancestor_ids: ['T250'] }),
    task('Blog', { priority: 6, children_ids: ['Article'] }),
    task('Article', { parent_id: 'Blog', ancestor_ids: ['Blog'] }),
    task('Milk', { priority: 2 }),
    task('Old', { priority: 10, is_done: true, completed_at: '2026-09-01T10:00:00Z' }),
];

describe('projectOptions', () => {
    it('lists open projects and sub-projects as a tree, top level by priority', () => {
        expect(projectOptions(tasks).map(p => [p.id, p.depth, p.path])).toEqual([
            ['T250', 0, 'T250'],
            ['HW', 1, 'T250 › Hardware Design'],
            ['Blog', 0, 'Blog'],
            ['Milk', 0, 'Milk'],
        ]);
    });

    it('never offers a recurring task: it cannot hold tasks', () => {
        const chore = task('Chore', { series_id: 's1', occurrence: '2026-10-06T20:00:00+02:00' });
        expect(projectOptions([...tasks, chore]).map(p => p.id)).not.toContain('Chore');
    });
});

describe('isInside / projectFor', () => {
    it('knows the subtree of a project', () => {
        const cad = tasks[2];
        expect(isInside(cad, 'T250')).toBe(true);
        expect(isInside(cad, 'HW')).toBe(true);
        expect(isInside(cad, 'Blog')).toBe(false);
        expect(isInside(tasks[1], 'HW')).toBe(true); // a project is inside itself
    });

    it('finds the project a tracked task belongs to (§2)', () => {
        const byId = new Map(tasks.map(t => [t.id, t]));
        expect(projectFor(byId.get('CAD')!, byId)?.id).toBe('HW');
        expect(projectFor(byId.get('HW')!, byId)?.id).toBe('HW');
        expect(projectFor(byId.get('Milk')!, byId)?.id).toBe('Milk');
    });
});

describe('trackedTask', () => {
    it('is the task with an open session', () => {
        expect(trackedTask(tasks)).toBeNull();
        const running = [...tasks, task('Run', { active_tracking_start: '2026-09-28T09:00:00Z' })];
        expect(trackedTask(running)?.id).toBe('Run');
    });
});

describe('nextPlannedItem', () => {
    const item = (task_id: string, start_time: string, is_rest = false) => ({
        task_id, header: task_id, start_time, duration: 3600, warnings: [],
        is_fixed: false, is_appointment: false, hex_color: null, is_rest,
    });
    const plan: PlanResponse = {
        accepted_plan_id: 'p', warnings: [], appointments: [],
        buckets: [{
            id: 'b', start_date: '2026-09-28T09:00:00Z', end_date: '2026-09-28T17:00:00Z',
            type_name: 'Day', type_id: 1, hex_color: '#000', persisted: true,
            items: [
                item('Milk', '2026-09-28T09:00:00Z'),
                item('Article', '2026-09-28T11:00:00Z'),
                item('HW', '2026-09-28T13:00:00Z', true),
                item('CAD', '2026-09-28T15:00:00Z'),
            ],
        }],
    };
    const now = new Date('2026-09-28T10:30:00Z');

    it('is the first upcoming item inside the active project', () => {
        expect(nextPlannedItem(plan, tasks, 'T250', now)?.task_id).toBe('HW'); // its Rest
        expect(nextPlannedItem(plan, tasks, 'Blog', now)?.task_id).toBe('Article');
    });

    it('includes the item that is running right now', () => {
        expect(nextPlannedItem(plan, tasks, null, new Date('2026-09-28T09:30:00Z'))?.task_id).toBe('Milk');
    });

    it('is null when the project has nothing planned', () => {
        expect(nextPlannedItem(plan, tasks, 'FW', now)).toBeNull();
    });
});
