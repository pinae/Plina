/** WP-10: pure helpers for the plan chooser (docs/plan-chooser.md). */
import type { PlanAlternative, PlanItem, PlanWarning, Task } from '../types';

export type SlackSeverity = 'error' | 'warning' | 'success' | 'default';

/** Negative → over deadline (error); under a day → warning; else success. */
export function slackSeverity(seconds: number | null): SlackSeverity {
    if (seconds === null) return 'default';
    if (seconds < 0) return 'error';
    if (seconds < 24 * 3600) return 'warning';
    return 'success';
}

function humanize(totalSeconds: number): string {
    const totalMinutes = Math.round(totalSeconds / 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes && !days) parts.push(`${minutes}m`);
    return parts.length ? parts.join(' ') : '0m';
}

export function formatSlack(seconds: number | null): string {
    if (seconds === null) return 'no deadline pressure';
    if (seconds < 0) return `${humanize(-seconds)} over`;
    return `${humanize(seconds)} slack`;
}

export interface TimelineBlock {
    header: string;
    color: string;
    /** Seconds — flex weight for the strip. */
    weight: number;
    /** The same in every plan: drawn neutral (P7). */
    appointment?: boolean;
}

export interface TimelineDay {
    dayLabel: string;
    blocks: TimelineBlock[];
}

const FALLBACK_COLOR = '#9e9e9e';

/** Items not over yet at ``from`` (all without). */
const ahead = (items: PlanItem[], from?: Date) => (from
    ? items.filter(item => new Date(item.start_time).getTime() + item.duration * 1000 > from.getTime())
    : items);

/** The first `maxDays` days of an alternative (from ``from`` on) as
 *  proportional color strips. */
export function miniTimeline(
    alternative: PlanAlternative, maxDays = 3, from?: Date,
): TimelineDay[] {
    const items = ahead([
        ...alternative.appointments,
        ...alternative.buckets.flatMap(bucket => bucket.items),
    ], from).sort((a, b) => a.start_time.localeCompare(b.start_time));

    const byDay = new Map<string, TimelineDay>();
    for (const item of items) {
        const date = new Date(item.start_time);
        const key = date.toDateString();
        if (!byDay.has(key)) {
            if (byDay.size >= maxDays) break;
            byDay.set(key, {
                dayLabel: date.toLocaleDateString(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric',
                }),
                blocks: [],
            });
        }
        byDay.get(key)!.blocks.push({
            header: item.header,
            color: item.is_appointment ? FALLBACK_COLOR : item.hex_color ?? FALLBACK_COLOR,
            weight: item.duration,
            ...(item.is_appointment ? { appointment: true } : {}),
        });
    }
    return [...byDay.values()];
}

const byStart = (a: PlanItem, b: PlanItem) => a.start_time.localeCompare(b.start_time);
const workOf = (alternative: PlanAlternative) => alternative.buckets.flatMap(bucket => bucket.items)
    .filter(item => !item.is_appointment).sort(byStart);

export interface NextTask {
    taskId: string;
    header: string;
    color: string | null;
    start: Date;
    /** Being tracked: the plan goes on with it now. */
    running: boolean;
}

/** The first tasks an option does, in order (appointments aside). */
export function nextTasks(
    alternative: PlanAlternative, { runningTaskId = null, count = 3 }: { runningTaskId?: string | null; count?: number } = {},
): NextTask[] {
    const result: NextTask[] = [];
    const seen = new Set<string>();
    for (const item of workOf(alternative)) {
        const key = `${item.task_id}:${Boolean(item.is_rest)}`; // a parent and its Rest are two
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
            taskId: item.task_id, header: item.header, color: item.hex_color, start: new Date(item.start_time),
            running: item.task_id === runningTaskId && !item.is_rest,
        });
        if (result.length === count) break;
    }
    return result;
}

/** How many tasks (and Rests) a plan holds. */
export const taskCount = (alternative: PlanAlternative) =>
    new Set(workOf(alternative).map(item => `${item.task_id}:${Boolean(item.is_rest)}`)).size;

export interface PlanDay {
    dayLabel: string;
    items: { taskId: string; header: string; start: Date; end: Date; isAppointment: boolean }[];
}

/** The whole plan, day by day (appointments included), from ``from`` on. */
export function planByDay(alternative: PlanAlternative, from?: Date): PlanDay[] {
    const items = ahead([...alternative.appointments, ...alternative.buckets.flatMap(bucket => bucket.items)], from)
        .sort(byStart);
    const days = new Map<string, PlanDay>();
    for (const item of items) {
        const start = new Date(item.start_time);
        const key = start.toDateString();
        if (!days.has(key)) {
            days.set(key, {
                dayLabel: start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
                items: [],
            });
        }
        days.get(key)!.items.push({
            taskId: item.task_id, header: item.header, start,
            end: new Date(start.getTime() + item.duration * 1000), isAppointment: item.is_appointment,
        });
    }
    return [...days.values()];
}

const warningKey = (warning: PlanWarning) => `${warning.task_id}:${warning.kind}`;

/** Warnings every option has (said once, P7); none for a single option. */
export function commonWarnings(alternatives: PlanAlternative[]): PlanWarning[] {
    if (alternatives.length < 2) return [];
    const [first, ...others] = alternatives;
    return first.warnings.filter(warning =>
        others.every(other => other.warnings.some(w => warningKey(w) === warningKey(warning))));
}

export const isCommon = (warning: PlanWarning, common: PlanWarning[]) =>
    common.some(w => warningKey(w) === warningKey(warning));

/** The project a task belongs to (its top-level task); null for a single step. */
export function projectOf(taskId: string, tasks: Task[]): string | null {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;
    const rootId = task.ancestor_ids?.[0];
    if (rootId) return tasks.find(t => t.id === rootId)?.header ?? null;
    return task.children_ids?.length ? task.header : null;
}
