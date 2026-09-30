/** Test/story fixtures for the task tree (UI-5+): a Task factory and the
 *  T250 › Hardware Design › CAD / Company Blog example from the spec. */
import { QueryClient } from '@tanstack/react-query';
import type { PlanAlternative, Tag, Task, UserSettings } from '../types.ts';

export const API = 'http://localhost:8000/api';

/** The tree fields of a Task with neutral values: an open top-level leaf. */
export const treeDefaults = {
    parent_id: null, order: 0, children_ids: [], ancestor_ids: [], effective_deadline: null,
    is_estimated: true, parts_total: null, rest: null, over_budget: false,
    completion_estimate: null, completion_first_estimate: null, completion_time_spent: null,
    completion_subtree_time_spent: null, completion_dropped_rest: null,
} satisfies Partial<Task>;

export const makeTask = (id: string, over: Partial<Task> = {}): Task => ({
    id, header: id, description: '', start_date: null, duration: '01:00:00',
    latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null,
    is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
    active_tracking_start: null, ...treeDefaults, ...over,
});

export const makerTag: Tag = { id: 'tag-maker', name: 'maker', hex_color: '#3f51b5' };

export const treeTasks = (): Task[] => [
    makeTask('t250', { header: 'T250', priority: 9, duration: '20:00:00', children_ids: ['hw'],
        hex_color: '#e91e63', parts_total: '12:00:00', rest: '08:00:00' }),
    makeTask('hw', { header: 'Hardware Design', parent_id: 't250', ancestor_ids: ['t250'],
        duration: '12:00:00', children_ids: ['cad'], tags: [makerTag], priority: 7,
        parts_total: '03:00:00', rest: '09:00:00' }),
    makeTask('cad', { header: 'CAD', parent_id: 'hw', ancestor_ids: ['t250', 'hw'],
        duration: '03:00:00', tags: [makerTag], priority: 7 }),
    makeTask('blog', { header: 'Company Blog', priority: 6, children_ids: ['article'],
        duration: '09:00:00', parts_total: '03:00:00', rest: '06:00:00' }),
    makeTask('article', { header: 'Write CMS comparison', parent_id: 'blog', ancestor_ids: ['blog'],
        duration: '03:00:00' }),
];

export const settingsFor = (tasks: Task[], activeId: string | null): UserSettings => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const active = activeId ? byId.get(activeId) : undefined;
    const path = active
        ? [...(active.ancestor_ids ?? []), active.id].map(id => ({ id, header: byId.get(id)!.header }))
        : [];
    return { default_duration: '01:00:00', active_task_id: activeId, active_task_path: path, time_zone: '' };
};

export const makeAlternative = (id: string, label: string): PlanAlternative => ({
    id, label, feasible: true, warnings: [],
    metrics: {
        min_slack_seconds: 2 * 24 * 3600, context_switches: 2, priority_earliness_hours: 4,
        project_finishes: [{ project_id: 't250', name: 'T250', finish: '2026-10-09T11:00:00Z' }],
    },
    appointments: [],
    buckets: [],
});

/** A QueryClient pre-filled with the tree fixtures (stories: no backend). */
export function seededClient(options: { activeId?: string | null; trackedId?: string | null } = {}): QueryClient {
    const { activeId = 'hw', trackedId = null } = options;
    const tasks = treeTasks().map(t => t.id === trackedId
        ? { ...t, active_tracking_start: new Date(Date.now() - 42 * 60_000).toISOString() } : t);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(['tasks'], tasks);
    client.setQueryData(['tags'], [makerTag]);
    client.setQueryData(['settings'], settingsFor(tasks, activeId));
    client.setQueryData(['plan'], { accepted_plan_id: null, warnings: [], appointments: [], buckets: [] });
    return client;
}
