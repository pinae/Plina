/**
 * Apply a live drag to the *other* tasks in the Week view:
 *
 * - an auto-planned task the edit overlaps becomes `valid: false` (it can no
 *   longer exist as planned and will be re-planned);
 * - an appointment overlapped by a *moved appointment* shrinks to the half of
 *   the column away from the cursor (it never becomes invalid);
 * - the dragged task itself, fixed tasks and non-overlapping tasks are left
 *   untouched.
 */
import type { ActiveDrag, ViewTask } from '../components/WeekViewTask/WeekViewTask.tsx';

export function applyDragOverlay(tasks: ViewTask[], drag: ActiveDrag | null): ViewTask[] {
    if (!drag) return tasks;
    const start = drag.start.getTime();
    const end = start + drag.durationMinutes * 60000;
    const shrinkSide = drag.cursorHalf === 'left' ? 'right' : 'left';

    return tasks.map(task => {
        if (task.taskId === drag.taskId) return task;
        const taskStart = new Date(task.startTime).getTime();
        const taskEnd = taskStart + task.duration * 60000;
        if (!(taskStart < end && start < taskEnd)) return task;

        if (task.isAppointment) {
            return drag.isAppointment && drag.mode === 'move'
                ? { ...task, shrinkSide }
                : task;
        }
        if (!task.manuallySet) return { ...task, valid: false };
        return task;
    });
}
