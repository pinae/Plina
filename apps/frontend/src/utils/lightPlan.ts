/**
 * Planning light (README: Planning light): what the Week view and the
 * tracker show between two real plans. Nothing re-plans by itself any more;
 * the stored plan is fitted to what happened since — in the browser, from
 * the plan, the tasks and the clock, so every device shows the same and a
 * reload changes nothing.
 *
 * - Appointments come from the tasks themselves: new and moved ones show at
 *   once, where they are.
 * - The tracked task is a block from its start until now.
 * - A pinned task (dropped in the Week view) stays where it was put. Once its
 *   time has come what is left of it goes into its planned slices, or,
 *   without any, moves along with now.
 * - Planned work keeps its bucket and its order. Each task's slices carry the
 *   work it still needs (estimate − time spent, a parent's Rest); slices
 *   missed earlier today come back at now; then every bucket is packed from
 *   now on around appointments, the tracked task and pinned tasks, never
 *   before a predecessor ends. Work never moves to another day: what no
 *   longer fits its bucket is listed, for "Re-plan".
 */
import type { Dependency, PlanItem, PlanResponse, PlannedBucket, Task } from '../types.ts';
import { parseDurationMinutes } from './duration.ts';

const MINUTE = 60_000;
/** As the planner (MIN_TASK_SLICE): no slice starts in a gap shorter than
 *  this unless it finishes there. */
const MIN_SLICE = 15 * MINUTE;

export interface LightPlanNote {
    taskId: string;
    header: string;
    minutes: number;
}

export interface LightPlanNotes {
    /** Work that no longer fits its day as planned. */
    overflow: LightPlanNote[];
    /** Work of tasks whose planned days are over: no place left in the plan. */
    dropped: LightPlanNote[];
}

export interface LightPlan {
    plan: PlanResponse;
    notes: LightPlanNotes;
}

export interface LightPlanContext {
    tasks: Task[];
    dependencies: Dependency[];
    now: Date;
    /** The user's default duration (minutes): the estimate of tasks without one. */
    defaultMinutes: number;
}

type Interval = [number, number];

/** A planned slice on its way through the light planner. */
interface Unit {
    item: PlanItem;
    bucket: PlannedBucket | null;
    task: Task;
    start: number;
    /** Work it carries now (ms). */
    length: number;
    /** Missed earlier today: back at now. */
    revived?: boolean;
}

const startOf = (item: PlanItem) => new Date(item.start_time).getTime();
const endOf = (item: PlanItem) => startOf(item) + item.duration * 1000;
const overlaps = (a: Interval, b: Interval) => a[0] < b[1] && b[0] < a[1];

function endOfDay(ms: number): number {
    const day = new Date(ms);
    day.setHours(24, 0, 0, 0);
    return day.getTime();
}

function startOfDay(ms: number): number {
    const day = new Date(ms);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
}

/** Free time from ``from`` up to ``until``, around ``occupied`` (sorted):
 *  slices for ``length`` ms, and what is left over. */
function fill(length: number, from: number, until: number, occupied: Interval[]): { pieces: Interval[]; left: number } {
    const pieces: Interval[] = [];
    let cursor = from;
    let left = length;
    while (left > 0 && cursor < until) {
        const blocking = occupied.find(([start, end]) => start <= cursor && cursor < end);
        if (blocking) { cursor = blocking[1]; continue; }
        const next = occupied.find(([start]) => start > cursor);
        const gapEnd = Math.min(next ? next[0] : Infinity, until);
        const gap = gapEnd - cursor;
        if (gap >= MIN_SLICE || gap >= left) {
            const take = Math.min(gap, left);
            pieces.push([cursor, cursor + take]);
            left -= take;
        }
        cursor = gapEnd;
    }
    return { pieces, left };
}

function occupy(occupied: Interval[], interval: Interval) {
    occupied.push(interval);
    occupied.sort((a, b) => a[0] - b[0]);
}

export function lightPlan(plan: PlanResponse, { tasks, dependencies, now, defaultMinutes }: LightPlanContext): LightPlan {
    const nowMs = now.getTime();
    const today = startOfDay(nowMs);
    const byId = new Map(tasks.map(task => [task.id, task]));
    const minutes = (value: string | null | undefined) => parseDurationMinutes(value ?? null);
    const running = (task: Task) => (task.active_tracking_start
        ? Math.max(0, nowMs - new Date(task.active_tracking_start).getTime()) : 0);
    /** Work a planning unit still needs (ms). */
    const needed = (task: Task, isRest: boolean) => {
        if (task.is_done) return 0;
        if (isRest) return (minutes(task.rest) ?? 0) * MINUTE;
        const estimate = (minutes(task.duration) ?? defaultMinutes) * MINUTE;
        return Math.max(0, estimate - (minutes(task.time_spent) ?? 0) * MINUTE - running(task));
    };
    const colorOf = (task: Task, fallback: string | null) => task.hex_color ?? fallback;
    const makeItem = (task: Task, interval: Interval, base: Partial<PlanItem>): PlanItem => {
        const deadline = task.latest_finish_date ? new Date(task.latest_finish_date).getTime() : null;
        return {
            task_id: task.id,
            header: base.is_rest ? `Rest of ${task.header}` : task.header,
            is_rest: Boolean(base.is_rest),
            start_time: new Date(interval[0]).toISOString(),
            duration: (interval[1] - interval[0]) / 1000,
            warnings: deadline !== null && interval[1] > deadline ? ['Deadline exceeded'] : [],
            is_fixed: base.is_fixed ?? task.is_fixed,
            is_appointment: task.is_appointment,
            hex_color: colorOf(task, base.hex_color ?? null),
            ...(base.order !== undefined ? { order: base.order } : {}),
        };
    };

    const allItems = [
        ...plan.appointments.map(item => ({ item, bucket: null as PlannedBucket | null })),
        ...plan.buckets.flatMap(bucket => bucket.items.map(item => ({ item, bucket }))),
    ].filter(({ item }) => byId.has(item.task_id));
    const hasFluidItems = new Set(allItems.filter(({ bucket }) => bucket !== null).map(({ item }) => item.task_id));

    // ------------------------------------------------ anchored: from the tasks
    const anchored: PlanItem[] = [];
    const occupied: Interval[] = [];
    const sliding: Task[] = [];
    /** Tasks not planned from their plan slices (shown from the task). */
    const fromTask = new Set<string>();
    for (const task of tasks) {
        if (task.is_done || task.children_ids?.length) continue;
        if (task.active_tracking_start && !task.is_appointment) {
            // Being worked on: from its start until now; what is left of it
            // stays where it is planned (or, pinned, goes on from now).
            const interval: Interval = [new Date(task.active_tracking_start).getTime(), nowMs];
            if (interval[1] > interval[0]) {
                anchored.push(makeItem(task, interval, { is_fixed: true }));
                occupy(occupied, interval);
            }
            if (!hasFluidItems.has(task.id)) { fromTask.add(task.id); sliding.push(task); }
            continue;
        }
        if (!task.start_date) continue;
        const start = new Date(task.start_date).getTime();
        if (task.is_appointment) {
            const interval: Interval = [start, start + (minutes(task.duration) ?? defaultMinutes) * MINUTE];
            anchored.push(makeItem(task, interval, { is_fixed: task.is_fixed }));
            occupy(occupied, interval);
            fromTask.add(task.id);
            continue;
        }
        if (!task.is_fixed) continue;
        const left = needed(task, false);
        if (start >= nowMs) {
            // Pinned ahead: where it was put.
            if (left > 0) {
                const interval: Interval = [start, start + left];
                anchored.push(makeItem(task, interval, { is_fixed: true }));
                occupy(occupied, interval);
            }
            fromTask.add(task.id);
        } else if (!hasFluidItems.has(task.id)) {
            // Its time has come and it has no planned slices: from now on.
            fromTask.add(task.id);
            sliding.push(task);
        }
        // Its time has come: its planned slices carry what is left of it.
    }
    // Appointments (done ones too) of the plan: as they were. Done tasks'
    // other past slices: history.
    const history: { item: PlanItem; bucket: PlannedBucket | null }[] = [];
    for (const entry of allItems) {
        const task = byId.get(entry.item.task_id)!;
        if (fromTask.has(task.id) && !task.is_done) continue;
        if (entry.bucket === null) {
            if (task.is_done || !task.start_date) history.push(entry);
        } else if (endOf(entry.item) <= nowMs) {
            history.push(entry); // revived ones are taken out below
        } else if (task.is_done && startOf(entry.item) < nowMs) {
            // Done while it was planned: up to when it was done.
            const done = Math.min(nowMs, task.completed_at ? new Date(task.completed_at).getTime() : nowMs);
            if (done > startOf(entry.item)) {
                history.push({ ...entry, item: { ...entry.item, duration: (done - startOf(entry.item)) / 1000 } });
            }
        }
    }

    const overflow = new Map<string, LightPlanNote>();
    const dropped = new Map<string, LightPlanNote>();
    const note = (notes: Map<string, LightPlanNote>, task: Task, isRest: boolean, ms: number) => {
        if (ms < MINUTE) return;
        const key = `${task.id}:${isRest}`;
        const header = isRest ? `Rest of ${task.header}` : task.header;
        const entry = notes.get(key) ?? { taskId: task.id, header, minutes: 0 };
        entry.minutes += Math.round(ms / MINUTE);
        notes.set(key, entry);
    };

    // A pinned task whose time has come: from now on, today.
    for (const task of sliding) {
        const left = needed(task, false);
        const { pieces, left: rest } = fill(left, nowMs, endOfDay(nowMs), occupied);
        for (const piece of pieces) {
            anchored.push(makeItem(task, piece, { is_fixed: true }));
            occupy(occupied, piece);
        }
        note(overflow, task, false, rest);
    }

    // ------------------------------------------------- planned work: reflow
    const fluid = allItems.filter(({ item, bucket }) => bucket !== null && !fromTask.has(item.task_id));
    const units = new Map<string, Unit[]>(); // per planning unit (task, Rest)
    for (const { item, bucket } of fluid) {
        const task = byId.get(item.task_id)!;
        const key = `${task.id}:${Boolean(item.is_rest)}`;
        units.set(key, [...(units.get(key) ?? []), { item, bucket, task, start: startOf(item), length: item.duration * 1000 }]);
    }
    const revivedKeys = new Set<PlanItem>();
    const toPlace: Unit[] = [];
    const firstOpenBucketToday = [...plan.buckets]
        .filter(bucket => new Date(bucket.end_date).getTime() > nowMs
            && new Date(bucket.start_date).getTime() < endOfDay(nowMs))
        .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null;
    for (const list of units.values()) {
        list.sort((a, b) => a.start - b.start);
        const { task } = list[0];
        const isRest = Boolean(list[0].item.is_rest);
        let left = needed(task, isRest);
        const future = list.filter(unit => endOf(unit.item) > nowMs);
        for (const unit of future) {
            unit.length = Math.min(unit.length, left);
            left -= unit.length;
        }
        if (left > 0) {
            // Missed earlier today: back at now, in the first bucket still open.
            for (const unit of list.filter(u => endOf(u.item) <= nowMs && u.start >= today)) {
                if (left <= 0) break;
                unit.length = Math.min(unit.length, left);
                unit.revived = true;
                left -= unit.length;
                revivedKeys.add(unit.item);
                if (firstOpenBucketToday) toPlace.push({ ...unit, bucket: firstOpenBucketToday });
                else note(overflow, task, isRest, unit.length);
            }
        }
        if (left > 0) {
            // A bigger estimate: the last slice grows.
            const last = future[future.length - 1]
                ?? toPlace.filter(unit => unit.revived && unit.task === task && Boolean(unit.item.is_rest) === isRest).at(-1);
            if (last) last.length += left;
            else note(dropped, task, isRest, left);
        }
        toPlace.push(...future.filter(unit => unit.length > 0));
    }

    // Dependencies: a task does not start before its predecessors (and those
    // of its ancestors, whose subtrees count as one) are done.
    const descendants = new Map<string, Set<string>>();
    for (const task of tasks) {
        for (const ancestor of task.ancestor_ids ?? []) {
            descendants.set(ancestor, (descendants.get(ancestor) ?? new Set()).add(task.id));
        }
    }
    const predecessorsOf = (task: Task) => {
        const successors = new Set([task.id, ...(task.ancestor_ids ?? [])]);
        const result = new Set<string>();
        for (const dependency of dependencies) {
            if (!successors.has(dependency.successor)) continue;
            const predecessor = byId.get(dependency.predecessor);
            if (!predecessor || predecessor.is_done) continue;
            result.add(predecessor.id);
            for (const id of descendants.get(predecessor.id) ?? []) result.add(id);
        }
        return result;
    };
    const ends = new Map<string, number>();
    const ended = (taskId: string, end: number) => ends.set(taskId, Math.max(ends.get(taskId) ?? 0, end));
    for (const item of anchored) ended(item.task_id, endOf(item));

    const placed = new Map<string, PlanItem[]>(); // bucket id → items
    const cursor = new Map<string, number>(); // bucket id → end of its last placed slice
    toPlace.sort((a, b) => a.bucket!.start_date.localeCompare(b.bucket!.start_date)
        || Number(Boolean(b.revived)) - Number(Boolean(a.revived)) || a.start - b.start);
    for (const unit of toPlace) {
        const bucket = unit.bucket!;
        const bucketStart = new Date(bucket.start_date).getTime();
        const bucketEnd = new Date(bucket.end_date).getTime();
        const notBefore = unit.task.series_id && !unit.task.is_appointment && unit.task.occurrence
            ? new Date(unit.task.occurrence).getTime() : 0;
        let from = Math.max(bucketStart, nowMs, cursor.get(bucket.id) ?? 0, notBefore);
        for (const id of predecessorsOf(unit.task)) from = Math.max(from, ends.get(id) ?? 0);
        const { pieces, left } = fill(unit.length, from, bucketEnd, occupied);
        for (const piece of pieces) {
            placed.set(bucket.id, [...(placed.get(bucket.id) ?? []),
                makeItem(unit.task, piece, { is_rest: unit.item.is_rest, is_fixed: false, hex_color: unit.item.hex_color, order: unit.item.order })]);
            occupy(occupied, piece);
            cursor.set(bucket.id, piece[1]);
            ended(unit.task.id, piece[1]);
        }
        note(overflow, unit.task, Boolean(unit.item.is_rest), left);
    }

    // History slices covered by what happens now (tracked, pinned) give way.
    const blocks: Interval[] = anchored.map(item => [startOf(item), endOf(item)]);
    const kept = history.filter(({ item, bucket }) => !revivedKeys.has(item)
        && (bucket === null || !blocks.some(block => overlaps(block, [startOf(item), endOf(item)]))));
    const byStart = (a: PlanItem, b: PlanItem) => a.start_time.localeCompare(b.start_time);

    return {
        plan: {
            ...plan,
            appointments: [...kept.filter(({ bucket }) => bucket === null).map(({ item }) => item), ...anchored].sort(byStart),
            buckets: plan.buckets.map(bucket => ({
                ...bucket,
                items: [
                    ...kept.filter(entry => entry.bucket?.id === bucket.id).map(({ item }) => item),
                    ...(placed.get(bucket.id) ?? []),
                ].sort(byStart),
            })),
        },
        notes: { overflow: [...overflow.values()], dropped: [...dropped.values()] },
    };
}

/** Whether the light plan had to leave work out ("Re-plan" helps). */
export const needsReplan = (notes: LightPlanNotes) => notes.overflow.length > 0 || notes.dropped.length > 0;
