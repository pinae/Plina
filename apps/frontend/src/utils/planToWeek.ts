/** WP-11: pure mapping from the plan payload to Week view structures. */
import type { PlanItem, PlanResponse } from '../types';
import type { ViewTask } from '../components/WeekViewTask/WeekViewTask.tsx';

const FALLBACK_COLOR = '#539dad';

export interface PlacedViewTask extends ViewTask {
    taskId: string;
    isAppointment: boolean;
}

function toViewTask(item: PlanItem): PlacedViewTask {
    return {
        taskId: item.task_id,
        title: item.header,
        startTime: item.start_time,
        duration: Math.round(item.duration / 60),
        color: item.hex_color ?? FALLBACK_COLOR,
        // Solid = anchored (fixed or appointment); pastel = fluid.
        manuallySet: item.is_fixed || item.is_appointment,
        isAppointment: item.is_appointment,
        description: item.warnings.join(', '),
        tags: [],
        continues: false,
    };
}

export function planToViewTasks(plan: PlanResponse): PlacedViewTask[] {
    return [
        ...plan.appointments.map(toViewTask),
        ...plan.buckets.flatMap(bucket => bucket.items.map(toViewTask)),
    ];
}

export interface BucketZone {
    id: string;
    start: Date;
    end: Date;
    color: string;
    label: string;
    persisted: boolean;
    typeId: number;
}

export function bucketsToZones(plan: PlanResponse): BucketZone[] {
    return plan.buckets.map(bucket => ({
        id: bucket.id,
        start: new Date(bucket.start_date),
        end: new Date(bucket.end_date),
        color: bucket.hex_color ?? FALLBACK_COLOR,
        label: bucket.type_name,
        persisted: bucket.persisted ?? true,
        typeId: bucket.type_id,
    }));
}

export interface DayZone extends BucketZone {
    topMinutes: number;
    heightMinutes: number;
}

/** Zones overlapping `day`, clamped to the day's 0..1440 minute range. */
export function zonesForDay(zones: BucketZone[], day: Date): DayZone[] {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return zones
        .filter(zone => zone.start < dayEnd && zone.end > dayStart)
        .map(zone => {
            const from = zone.start > dayStart ? zone.start : dayStart;
            const to = zone.end < dayEnd ? zone.end : dayEnd;
            const topMinutes = (from.getTime() - dayStart.getTime()) / 60000;
            return {
                ...zone,
                topMinutes,
                heightMinutes: (to.getTime() - from.getTime()) / 60000 ,
            };
        });
}

/** Translate a drop offset in a day column into a 15-minute snapped time. */
export function dropTimeFromOffset(
    day: Date, offsetY: number, columnHeight: number,
): Date {
    const minutes = (offsetY / columnHeight) * 24 * 60;
    const snapped = Math.round(minutes / 15) * 15;
    const time = new Date(day);
    time.setHours(0, snapped, 0, 0);
    return time;
}

/** A9: the first day (>= `from`) that offers bucket capacity but carries no
 *  planned work and no appointment — "when am I free for a new project?". */
export function firstFreeDay(plan: PlanResponse, from: Date): Date | null {
    const dayKey = (date: Date) => date.toDateString();
    const blocked = new Set(
        plan.appointments.map(item => dayKey(new Date(item.start_time))),
    );
    const byDay = new Map<string, { date: Date; hasItems: boolean }>();
    for (const bucket of plan.buckets) {
        const date = new Date(bucket.start_date);
        const key = dayKey(date);
        const entry = byDay.get(key) ?? { date, hasItems: false };
        entry.hasItems = entry.hasItems || bucket.items.length > 0;
        byDay.set(key, entry);
    }
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const candidates = [...byDay.values()]
        .filter(day => day.date >= start && !day.hasItems && !blocked.has(dayKey(day.date)))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    return candidates[0]?.date ?? null;
}
