/** UI-9: which projects and tags the quick-add sheet offers as chips —
 *  typing `#` or `+` is slow on a phone (docs/task-entry-ui.md §7). */
import type { ProjectOption } from './projects.ts';
import type { Tag, Task } from '../types.ts';

/** Recently used first, then the picker order (top level by priority). */
export function suggestProjects(options: ProjectOption[], recentIds: string[], max = 4): ProjectOption[] {
    const byId = new Map(options.map(p => [p.id, p]));
    const recent = recentIds.map(id => byId.get(id)).filter((p): p is ProjectOption => p !== undefined);
    const rest = options.filter(p => !recentIds.includes(p.id));
    return [...recent, ...rest].slice(0, max);
}

/** Recently used first, then by how many open tasks carry the tag. */
export function suggestTags(tags: Tag[], tasks: Task[], recentIds: string[], max = 6): Tag[] {
    const byId = new Map(tags.map(t => [t.id, t]));
    const uses = new Map<string, number>();
    for (const task of tasks) {
        if (task.is_done) continue;
        for (const t of task.tags) uses.set(t.id, (uses.get(t.id) ?? 0) + 1);
    }
    const recent = recentIds.map(id => byId.get(id)).filter((t): t is Tag => t !== undefined);
    const rest = tags.filter(t => !recentIds.includes(t.id))
        .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    return [...recent, ...rest].slice(0, max);
}
