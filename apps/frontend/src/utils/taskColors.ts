/**
 * Task colors (docs/task-entry-ui.md §4.4): a task shows its own color, else
 * its parent's; a project without one shows an automatic color the server
 * picks to differ from the other projects' (``Task.hex_color`` is what the
 * task shows, ``own_hex_color`` the chosen one, ``inherited_hex_color`` what
 * it shows without one).
 */
import type { Task } from '../types.ts';

/** The color picker's swatches: one OKLCH family (lightness 0.6) that keeps
 *  white text readable (contrast at least 3.7:1) and is easy to tell apart. */
export const TASK_COLOR_PALETTE: readonly { name: string; hex: string }[] = [
    { name: 'Red', hex: '#ca5551' },
    { name: 'Orange', hex: '#be6517' },
    { name: 'Amber', hex: '#a57710' },
    { name: 'Olive', hex: '#7e8814' },
    { name: 'Green', hex: '#25984d' },
    { name: 'Teal', hex: '#1b9388' },
    { name: 'Cyan', hex: '#238ea9' },
    { name: 'Blue', hex: '#477ed8' },
    { name: 'Violet', hex: '#8f68cb' },
    { name: 'Pink', hex: '#bc5694' },
];

/**
 * What the task would show without a color of its own, for the parent chosen
 * in the form: that parent's color; for a project its automatic color, which
 * a new project (or a task just made top-level) only gets when saved (null).
 */
export function inheritedColorFor(task: Task | undefined, parentId: string | null, tasks: Task[]): string | null {
    if (parentId) return tasks.find(t => t.id === parentId)?.hex_color ?? null;
    return task && task.parent_id === null ? task.inherited_hex_color : null;
}
