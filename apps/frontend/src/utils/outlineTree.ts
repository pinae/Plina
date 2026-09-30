/**
 * UI-7: the outline's rows derived from the task list (docs/task-entry-ui.md §5);
 * since T-3 one tree of all projects, the active one first (docs/tasks-tab.md).
 */
import type { Task } from '../types.ts';
import { parseDurationMinutes } from './duration.ts';

export type OutlineItem =
    | { kind: 'task'; key: string; task: Task; depth: number; hasChildren: boolean; expanded: boolean; path: string;
        /** The active (sub-)project itself. */
        active?: boolean }
    /** A parent's Rest, listed after its children. */
    | { kind: 'rest'; key: string; task: Task; depth: number };

const bySiblingOrder = (a: Task, b: Task) => (a.order ?? 0) - (b.order ?? 0) || a.header.localeCompare(b.header);

function childrenMap(tasks: Task[], includeDone = false) {
    const map = new Map<string | null, Task[]>();
    for (const task of tasks.filter(t => includeDone || !t.is_done)) {
        const key = task.parent_id ?? null;
        map.set(key, [...(map.get(key) ?? []), task]);
    }
    for (const list of map.values()) list.sort(bySiblingOrder);
    return map;
}

function pathOf(task: Task, byId: Map<string, Task>) {
    return (task.ancestor_ids ?? []).map(id => byId.get(id)?.header ?? '').join(' › ');
}

export interface OutlineOptions {
    /** The active (sub-)project: its top-level task comes first. */
    activeId: string | null;
    collapsed: Set<string>;
    /** Also list completed tasks, in their place in the tree. */
    showCompleted: boolean;
}

/** Visible rows: every project as a tree — the active project's top-level
 *  task first, the others in their own (manual) order. */
export function outlineItems(tasks: Task[], options: OutlineOptions): OutlineItem[] {
    const children = childrenMap(tasks, options.showCompleted);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const active = options.activeId ? byId.get(options.activeId) : undefined;
    const activeRoot = active ? (active.ancestor_ids?.[0] ?? active.id) : null;
    const tops = children.get(null) ?? [];
    const roots = [...tops.filter(t => t.id === activeRoot), ...tops.filter(t => t.id !== activeRoot)];
    const items: OutlineItem[] = [];
    const visit = (task: Task, depth: number) => {
        const kids = children.get(task.id) ?? [];
        const expanded = !options.collapsed.has(task.id);
        items.push({
            kind: 'task', key: task.id, task, depth, hasChildren: kids.length > 0, expanded,
            path: pathOf(task, byId), ...(task.id === options.activeId ? { active: true } : {}),
        });
        if (kids.length === 0 || !expanded) return;
        for (const child of kids) visit(child, depth + 1);
        if (!task.is_done && (parseDurationMinutes(task.rest ?? null) ?? 0) > 0) {
            items.push({ kind: 'rest', key: `rest:${task.id}`, task, depth: depth + 1 });
        }
    };
    for (const root of roots) visit(root, 0);
    return items;
}

/** Sorting session: open tasks without an own estimate, from all projects. */
export function inboxItems(tasks: Task[]): OutlineItem[] {
    const byId = new Map(tasks.map(t => [t.id, t]));
    return tasks
        .filter(t => !t.is_done && t.is_estimated === false)
        .map(task => ({ kind: 'task' as const, key: task.id, task, depth: 0, hasChildren: false, expanded: true, path: pathOf(task, byId) }))
        .sort((a, b) => a.path.localeCompare(b.path) || bySiblingOrder(a.task, b.task));
}

function siblings(task: Task, tasks: Task[]): Task[] {
    return childrenMap(tasks).get(task.parent_id ?? null) ?? [];
}

/** Tab: the previous sibling becomes the parent (null when there is none). */
export function indentParent(task: Task, tasks: Task[]): string | null {
    const list = siblings(task, tasks);
    const index = list.findIndex(t => t.id === task.id);
    return index > 0 ? list[index - 1].id : null;
}

/** Shift+Tab: the grandparent (null = top level); undefined when the task
 *  is top-level already. */
export function outdentParent(task: Task, tasks: Task[]): string | null | undefined {
    if (!task.parent_id) return undefined;
    return tasks.find(t => t.id === task.parent_id)?.parent_id ?? null;
}

/** Alt+↑/↓: swap with the neighbouring sibling; returns the order changes. */
export function reorderPatches(task: Task, tasks: Task[], direction: -1 | 1): { id: string; order: number }[] {
    const list = [...siblings(task, tasks)];
    const index = list.findIndex(t => t.id === task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return [];
    [list[index], list[target]] = [list[target], list[index]];
    return list
        .map((t, order) => ({ id: t.id, order, changed: (t.order ?? 0) !== order }))
        .filter(p => p.changed)
        .map(({ id, order }) => ({ id, order }));
}
