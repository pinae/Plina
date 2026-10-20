/**
 * Recurring tasks in the Tasks tab (README: Recurring tasks): every
 * occurrence is a task of its own, and they exist for the planning horizon
 * ahead. The tab lists only the next of those per series — none while a
 * task's due occurrence is still open — and a task's occurrence still ahead
 * says from when it is due.
 */
import type { Task } from '../types.ts';

const isAhead = (task: Task, now: Date) => task.occurrence !== null && new Date(task.occurrence) > now;

/** The tasks without the later of a series' occurrences still ahead. */
export function withoutLaterOccurrences(tasks: Task[], now: Date): Task[] {
    const next = new Map<string, Task>();
    const waiting = new Set<string>(); // a task's series with an open occurrence due: that one first
    for (const task of tasks) {
        if (!task.series_id || task.is_done) continue;
        if (!isAhead(task, now)) {
            if (!task.is_appointment) waiting.add(task.series_id);
            continue;
        }
        const known = next.get(task.series_id);
        if (!known || new Date(task.occurrence!) < new Date(known.occurrence!)) next.set(task.series_id, task);
    }
    return tasks.filter(task => !task.series_id || task.is_done || !isAhead(task, now)
        || (next.get(task.series_id) === task && !waiting.has(task.series_id)));
}

const shortDate = (iso: string) => new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: '2-digit', month: '2-digit',
});

/** The ↻ tooltip: "every Tuesday at 20:00 · next: Tue 13.10." */
export function recurrenceSummary(task: Task): string {
    const next = task.next_occurrence ? ` · next: ${shortDate(task.next_occurrence)}` : '';
    return `${task.recurrence_description ?? task.recurrence ?? ''}${next}`;
}

/** "from Tue 13.10." for an occurrence that is not due yet (not for appointments: they show their time). */
export function dueFrom(task: Task, now: Date): string | null {
    return task.series_id && !task.is_done && !task.is_appointment && isAhead(task, now)
        ? `from ${shortDate(task.occurrence!)}` : null;
}
