/**
 * UI-5: helpers around projects in the task tree (docs/task-entry-ui.md §2).
 * Projects are top-level tasks; tasks with subtasks are sub-projects.
 */
import type { PlanItem, PlanResponse, Task } from '../types.ts';

export interface ProjectOption {
    id: string;
    header: string;
    /** Breadcrumb, root first: "T250 › Hardware Design". */
    path: string;
    depth: number;
    color: string | null;
}

export const isProject = (task: Task) =>
    !task.parent_id || (task.children_ids?.length ?? 0) > 0;

/** Open projects and sub-projects as a tree: top level by priority, below
 *  in sibling order. */
export function projectOptions(tasks: Task[]): ProjectOption[] {
    const open = tasks.filter(t => !t.is_done);
    const children = new Map<string | null, Task[]>();
    for (const t of open) {
        const key = t.parent_id ?? null;
        children.set(key, [...(children.get(key) ?? []), t]);
    }
    const bySiblingOrder = (a: Task, b: Task) =>
        (a.order ?? 0) - (b.order ?? 0) || a.header.localeCompare(b.header);
    const byPriority = (a: Task, b: Task) => b.priority - a.priority || bySiblingOrder(a, b);

    const result: ProjectOption[] = [];
    const visit = (t: Task, depth: number, trail: string[]) => {
        if (!isProject(t)) return;
        const path = [...trail, t.header];
        result.push({ id: t.id, header: t.header, path: path.join(' › '), depth, color: t.hex_color });
        for (const child of [...(children.get(t.id) ?? [])].sort(bySiblingOrder)) {
            visit(child, depth + 1, path);
        }
    };
    for (const root of [...(children.get(null) ?? [])].sort(byPriority)) visit(root, 0, []);
    return result;
}

/** Whether ``task`` is ``projectId`` or lies in its subtree. */
export const isInside = (task: Task, projectId: string) =>
    task.id === projectId || (task.ancestor_ids ?? []).includes(projectId);

/** The project that becomes active when ``task`` is tracked (§2): the task
 *  itself or its nearest ancestor that is top-level or has subtasks. */
export function projectFor(task: Task, byId: Map<string, Task>): Task | null {
    let current: Task | undefined = task;
    while (current && !isProject(current)) {
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return current ?? null;
}

export const trackedTask = (tasks: Task[]) =>
    tasks.find(t => t.active_tracking_start !== null) ?? null;

/** The first planned item (running or upcoming) inside the project — or in
 *  any project when ``projectId`` is null. Rest placeholders count: ▶ on
 *  them tracks time on the parent. */
export function nextPlannedItem(plan: PlanResponse, tasks: Task[], projectId: string | null,
                                now: Date): PlanItem | null {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const candidates = plan.buckets
        .flatMap(bucket => bucket.items)
        .filter(item => new Date(item.start_time).getTime() + item.duration * 1000 > now.getTime())
        .filter(item => {
            const t = byId.get(item.task_id);
            return t !== undefined && !t.is_done && (projectId === null || isInside(t, projectId));
        })
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
    return candidates[0] ?? null;
}
