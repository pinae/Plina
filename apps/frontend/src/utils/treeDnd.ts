/**
 * T-6 (docs/tasks-tab.md): drag and drop in the task tree, as pure helpers.
 *
 * ``projectDrop`` follows dnd-kit's "sortable tree" projection: the dragged
 * row is placed where the pointer is (``overKey``) and the horizontal offset
 * decides the depth — one indent width per level, clamped so the row is at
 * most one level deeper than the row above and not shallower than the row
 * below. The position is expressed against the *stored* sibling order
 * (``index`` = place among the new siblings without the task itself, the
 * move endpoint's contract), so hidden completed tasks and the pinned active
 * project do not shift it.
 */
import type { Task } from '../types.ts';
import type { OutlineItem } from './outlineTree.ts';

export interface DropProjection {
    depth: number;
    parentId: string | null;
    index: number;
    /** False when the row would land where it already is. */
    changed: boolean;
}

type TaskRow = Extract<OutlineItem, { kind: 'task' }>;

const bySiblingOrder = (a: Task, b: Task) => (a.order ?? 0) - (b.order ?? 0) || a.header.localeCompare(b.header);

/** Siblings under ``parentId`` in stored order (completed ones included). */
function siblingsOf(tasks: Task[], parentId: string | null, without?: string): Task[] {
    return tasks.filter(t => (t.parent_id ?? null) === parentId && t.id !== without).sort(bySiblingOrder);
}

export function projectDrop(items: OutlineItem[], tasks: Task[], activeKey: string, overKey: string,
    offsetX: number, indentWidth: number): DropProjection | null {
    // Rest rows only display a parent's remainder; they hold no position.
    const all = items.filter((i): i is TaskRow => i.kind === 'task');
    const activeIndexAll = all.findIndex(i => i.key === activeKey);
    if (activeIndexAll < 0) return null;
    const active = all[activeIndexAll];
    // The subtree travels along: it is no drop target.
    let end = activeIndexAll + 1;
    while (end < all.length && all[end].depth > active.depth) end++;
    const rows = [...all.slice(0, activeIndexAll + 1), ...all.slice(end)];
    const overIndex = rows.findIndex(i => i.key === overKey);
    if (overIndex < 0) return null;

    const moved = [...rows];
    moved.splice(overIndex, 0, ...moved.splice(activeIndexAll, 1));
    const previous = moved[overIndex - 1];
    const next = moved[overIndex + 1];

    const projected = active.depth + Math.round(offsetX / indentWidth);
    // Never a subtask of a completed task.
    const maxDepth = previous ? previous.depth + (previous.task.is_done ? 0 : 1) : 0;
    const minDepth = next ? next.depth : 0;
    const depth = Math.max(minDepth, Math.min(projected, maxDepth));

    // The parent: the nearest row above that is one level up.
    let parent: TaskRow | null = null;
    if (depth > 0) {
        for (let i = overIndex - 1; i >= 0; i--) {
            if (moved[i].depth === depth - 1) { parent = moved[i]; break; }
        }
        if (!parent) return null;
    }
    const parentId = parent ? parent.task.id : null;

    // The visible sibling right above, if any (stop at the parent).
    let after: TaskRow | null = null;
    for (let i = overIndex - 1; i >= 0; i--) {
        if (moved[i].depth < depth) break;
        if (moved[i].depth === depth) { after = moved[i]; break; }
    }
    const siblings = siblingsOf(tasks, parentId, active.task.id);
    let index: number;
    if (after) index = siblings.findIndex(t => t.id === after!.task.id) + 1;
    else if (parent && !parent.expanded) index = siblings.length; // its subtasks are hidden: append
    else index = 0;

    const currentIndex = siblingsOf(tasks, active.task.parent_id ?? null, active.task.id)
        .filter(t => bySiblingOrder(t, active.task) < 0).length;
    const changed = parentId !== (active.task.parent_id ?? null) || index !== currentIndex;
    return { depth, parentId, index, changed };
}

/** The task list after moving ``taskId`` under ``parentId`` at ``index`` —
 *  for the optimistic update while the server confirms. */
export function applyMove(tasks: Task[], taskId: string, parentId: string | null, index: number): Task[] {
    const byId = new Map(tasks.map(t => [t.id, { ...t }]));
    const task = byId.get(taskId);
    if (!task) return tasks;
    const oldParentId = task.parent_id ?? null;
    const newSiblings = siblingsOf([...byId.values()], parentId, taskId);
    newSiblings.splice(Math.max(0, Math.min(index, newSiblings.length)), 0, task);
    newSiblings.forEach((t, order) => { t.order = order; t.parent_id = parentId; });
    if (oldParentId !== parentId) {
        siblingsOf([...byId.values()], oldParentId, taskId).forEach((t, order) => { t.order = order; });
    }
    // Ancestors of the moved subtree (root first).
    const parent = parentId ? byId.get(parentId) : undefined;
    const base = parent ? [...(parent.ancestor_ids ?? []), parent.id] : [];
    const oldBase = task.ancestor_ids ?? [];
    for (const t of byId.values()) {
        if (t.id === taskId) t.ancestor_ids = base;
        else if (t.ancestor_ids?.includes(taskId)) {
            t.ancestor_ids = [...base, ...t.ancestor_ids.slice(oldBase.length)];
        }
    }
    for (const id of [oldParentId, parentId]) {
        const p = id ? byId.get(id) : undefined;
        if (p) p.children_ids = siblingsOf([...byId.values()], p.id).map(t => t.id);
    }
    return tasks.map(t => byId.get(t.id)!);
}

// Keyboard and row-button moves (Tab, Shift+Tab, Alt+↑/↓) as move targets.

export interface MoveTarget { parentId: string | null; index: number }

const openSiblingsOf = (tasks: Task[], parentId: string | null) =>
    siblingsOf(tasks, parentId).filter(t => !t.is_done);

/** Tab: into the previous open sibling, appended to its subtasks. */
export function indentMove(tasks: Task[], taskId: string): MoveTarget | null {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;
    const open = openSiblingsOf(tasks, task.parent_id ?? null);
    const above = open[open.findIndex(t => t.id === taskId) - 1];
    if (!above) return null;
    return { parentId: above.id, index: siblingsOf(tasks, above.id).length };
}

/** Shift+Tab: one level up, right after the old parent. */
export function outdentMove(tasks: Task[], taskId: string): MoveTarget | null {
    const task = tasks.find(t => t.id === taskId);
    const parent = task?.parent_id ? tasks.find(t => t.id === task.parent_id) : undefined;
    if (!task || !parent) return null;
    const grandParentId = parent.parent_id ?? null;
    return { parentId: grandParentId, index: siblingsOf(tasks, grandParentId, taskId).findIndex(t => t.id === parent.id) + 1 };
}

/** Alt+↑/↓: past the neighbouring open sibling (hidden completed ones are
 *  skipped, so every press visibly moves the row). */
export function neighbourMove(tasks: Task[], taskId: string, direction: -1 | 1): MoveTarget | null {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;
    const parentId = task.parent_id ?? null;
    const open = openSiblingsOf(tasks, parentId);
    const neighbour = open[open.findIndex(t => t.id === taskId) + direction];
    if (!neighbour) return null;
    const position = siblingsOf(tasks, parentId, taskId).findIndex(t => t.id === neighbour.id);
    return { parentId, index: direction > 0 ? position + 1 : position };
}

/** Where a task is now, in the move endpoint's terms (for Undo). */
export function currentPosition(tasks: Task[], taskId: string): MoveTarget | null {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;
    const parentId = task.parent_id ?? null;
    return { parentId, index: siblingsOf(tasks, parentId, taskId).filter(t => bySiblingOrder(t, task) < 0).length };
}

/** At the end of ``parentId``'s subtasks (the M picker). */
export const appendTarget = (tasks: Task[], taskId: string, parentId: string | null): MoveTarget =>
    ({ parentId, index: siblingsOf(tasks, parentId, taskId).length });

