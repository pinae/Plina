/**
 * UI-6: between the task tree and the split editor's rows.
 */
import type { SplitRow, Task } from '../types.ts';
import { newRow, toTree, type OutlineNode, type OutlineRow } from './outline.ts';
import { parseDurationMinutes, minutesToDurationString } from './duration.ts';
import type { RowBudget } from './splitMath.ts';

/** The task's whole subtree as rows (so the save can describe it fully). */
export function rowsFromTasks(task: Task, tasks: Task[]): OutlineRow[] {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const rows: OutlineRow[] = [];
    const visit = (id: string, depth: number) => {
        const child = byId.get(id);
        if (!child) return;
        rows.push({
            ...newRow(depth, child.header), id: child.id, minutes: parseDurationMinutes(child.duration),
            done: child.is_done,
        });
        for (const grandchild of child.children_ids ?? []) visit(grandchild, depth + 1);
    };
    for (const id of task.children_ids ?? []) visit(id, 0);
    return rows;
}

/** Rows → split request rows. Ghosts are written as real estimates (§4.3);
 *  empty new rows are dropped; every row lists its children, so the
 *  request describes the complete outline. */
export function rowsToRequest(rows: OutlineRow[], budgets: Map<string, RowBudget>,
                              newTagIds: Map<string, string>): SplitRow[] {
    const convert = (nodes: OutlineNode[]): SplitRow[] => nodes
        .filter(node => node.row.header.trim() !== '' || node.row.id || node.children.length > 0)
        .map(({ row, children }) => {
            const minutes = budgets.get(row.key)?.minutes ?? row.minutes;
            const tagIds = [...(row.tagIds ?? []), ...(row.newTags ?? []).map(name => newTagIds.get(name)!)];
            return {
                ...(row.id ? { id: row.id } : {}),
                header: row.header.trim(),
                // Completed parts keep their estimate (it is history now).
                ...(row.done ? {} : {
                    duration: minutes !== null && minutes !== undefined ? minutesToDurationString(minutes) : null,
                }),
                ...(tagIds.length ? { tag_ids: tagIds } : {}),
                ...(row.priority !== undefined ? { priority: row.priority } : {}),
                ...(row.deadline ? { latest_finish_date: row.deadline } : {}),
                children: convert(children),
            };
        });
    return convert(toTree(rows));
}
