/**
 * Optimistic, in-place edit of the plan when a task is moved/resized in the
 * Week view.
 *
 * Placing a task pins it (is_fixed) at the new slot immediately so it never
 * snaps back to its old position while the server round-trip completes. Any
 * *automatically* planned task that now overlaps the moved task is marked
 * `valid: false` — it can no longer exist as planned, so the UI fades it at
 * once instead of leaving a stale card sitting under the new one.
 */
import type { PlanItem, PlanResponse } from '../types';

const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    aStart < bEnd && bStart < aEnd;

/** Duration (seconds) of the planned task, or null if it is not in the plan. */
export function findItemDurationSeconds(plan: PlanResponse, taskId: string): number | null {
    const all = [...plan.appointments, ...plan.buckets.flatMap(bucket => bucket.items)];
    return all.find(item => item.task_id === taskId)?.duration ?? null;
}

export function applyPlacement(
    plan: PlanResponse,
    taskId: string,
    startISO: string,
    durationSeconds: number,
): PlanResponse {
    const newStart = new Date(startISO).getTime();
    const newEnd = newStart + durationSeconds * 1000;

    const updateItem = (item: PlanItem): PlanItem => {
        if (item.task_id === taskId) {
            // The moved task: anchored at its new slot, always valid.
            return {
                ...item,
                start_time: startISO,
                duration: durationSeconds,
                is_fixed: true,
                valid: true,
            };
        }
        // Invalidate auto-planned tasks (not fixed, not appointments) that the
        // move now overlaps — they are about to be re-planned.
        if (!item.is_fixed && !item.is_appointment) {
            const start = new Date(item.start_time).getTime();
            const end = start + item.duration * 1000;
            if (rangesOverlap(newStart, newEnd, start, end)) {
                return { ...item, valid: false };
            }
        }
        return item;
    };

    return {
        ...plan,
        appointments: plan.appointments.map(updateItem),
        buckets: plan.buckets.map(bucket => ({ ...bucket, items: bucket.items.map(updateItem) })),
    };
}
