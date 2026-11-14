/**
 * UI-5: state and actions of the header tracker (docs/task-entry-ui.md §3.2),
 * shared by the tracker component and the T shortcut so there is one set of
 * mutation states and one place that shows errors.
 */
import { useState } from 'react';
import type { AxiosError } from 'axios';

import {
    useCompleteTask, useSettings, useStartTracking, useStartWork, useStopTracking, useStopWork, useTasks, useWorkBlocks,
} from '../queries.tsx';
import { useOpenSortTime } from '../components/SortTimeDialog/sortTimeContext.ts';
import { useLightPlan } from './useLightPlan.ts';
import type { PlanItem, Task, TrackedSession, TrackingBlockedError, WorkBlock } from '../types.ts';
import { ranLong } from '../utils/workBlocks.ts';
import { parseDurationMinutes } from '../utils/duration.ts';
import { isInside, nextPlannedItem, projectFor, trackedTask } from '../utils/projects.ts';
import { useNow } from './useNow.ts';

export interface TrackerControls {
    tracked: Task | null;
    /** Breadcrumb of the tracked task's project when it is not inside the
     *  active project (§3.2: shown as a small prefix). */
    outsidePath: string | null;
    /** First planned item inside the active project (idle state). */
    next: PlanItem | null;
    /** Open single steps: the active project's first, then all others. */
    pickable: { inProject: Task[]; others: Task[] };
    defaultDurationMinutes: number;
    start: (taskId: string) => void;
    stop: () => void;
    complete: () => void;
    /** T: stop the running task, or start the next one. */
    toggle: () => void;
    pending: boolean;
    error: string | null;
    clearError: () => void;
    // Sorting tracked time afterwards (docs/sort-time.md):
    /** Work begun with "Start work", running. */
    work: WorkBlock | null;
    /** Stretches that ended and wait to be sorted. */
    toSort: WorkBlock[];
    startWork: () => void;
    /** Stops it and opens the sort sheet. */
    stopWork: () => void;
    sort: (block: WorkBlock) => void;
    /** The session just stopped ran long: "Only this task?". */
    longSession: { header: string; seconds: number } | null;
    splitLongSession: () => void;
    dismissLongSession: () => void;
}

function describeError(error: unknown, fallback: string): string {
    const data = (error as AxiosError<TrackingBlockedError>)?.response?.data;
    if (data?.predecessors?.length) {
        return `Can’t start yet — first finish ${data.predecessors.map(p => `“${p.header}”`).join(', ')}.`;
    }
    return data?.detail ?? fallback;
}

export function useTracker(
    /** Parents that completed with the tracked task (for the undo snackbar). */
    onAutoCompleted?: (completed: { id: string; header: string }[]) => void,
): TrackerControls {
    const tasks = useTasks();
    const settings = useSettings();
    const plan = useLightPlan(); // what the Week view shows (README: Planning light)
    const startMutation = useStartTracking();
    const stopMutation = useStopTracking();
    const completeMutation = useCompleteTask();
    const blocks = useWorkBlocks();
    const startWorkMutation = useStartWork();
    const stopWorkMutation = useStopWork();
    const openSort = useOpenSortTime();
    const now = useNow(30_000);
    const [error, setError] = useState<string | null>(null);
    const [long, setLong] = useState<{ session: TrackedSession; header: string } | null>(null);

    const list = tasks.data ?? [];
    const byId = new Map(list.map(t => [t.id, t]));
    const tracked = trackedTask(list);
    const activeId = settings.data?.active_task_id ?? null;

    let outsidePath: string | null = null;
    if (tracked && !(activeId && isInside(tracked, activeId))) {
        const project = projectFor(tracked, byId);
        if (project && project.id !== tracked.id) {
            outsidePath = [...(project.ancestor_ids ?? []), project.id]
                .map(id => byId.get(id)?.header ?? '').join(' › ');
        }
    }

    const leaves = list.filter(t => !t.is_done && !t.is_appointment && !(t.children_ids?.length));
    const inProject = activeId ? leaves.filter(t => isInside(t, activeId)) : [];
    const pickable = { inProject, others: leaves.filter(t => !inProject.includes(t)) };
    const next = plan.data ? nextPlannedItem(plan.data.plan, list, activeId, now) : null;

    const defaultDurationMinutes = parseDurationMinutes(settings.data?.default_duration ?? null) ?? 60;
    /** A session that ran long may have covered more tasks. */
    const askIfLong = ({ task, session }: { task: Task; session?: TrackedSession | null }) => {
        if (session && ranLong(session, task, defaultDurationMinutes)) setLong({ session, header: task.header });
    };
    const work = blocks.data?.find(block => block.running) ?? null;

    const start = (taskId: string) =>
        startMutation.mutate(taskId, { onError: e => setError(describeError(e, 'Could not start tracking.')) });
    const stop = () => {
        if (tracked) {
            stopMutation.mutate(tracked.id, {
                onSuccess: askIfLong,
                onError: e => setError(describeError(e, 'Could not stop tracking.')),
            });
        }
    };
    const complete = () => {
        if (!tracked) return;
        completeMutation.mutate(tracked.id, {
            onSuccess: data => {
                if (data.auto_completed?.length) onAutoCompleted?.(data.auto_completed);
                askIfLong(data);
            },
            onError: e => setError(describeError(e, 'Could not complete the task.')),
        });
    };

    function stopWork() {
        stopWorkMutation.mutate(undefined, {
            onSuccess: block => { if (block) openSort({ block }); },
            onError: e => setError(describeError(e, 'Could not stop work.')),
        });
    }

    return {
        tracked, outsidePath, next, pickable,
        defaultDurationMinutes,
        start, stop, complete,
        toggle: () => (tracked ? stop() : work ? stopWork() : next ? start(next.task_id) : undefined),
        pending: startMutation.isPending || stopMutation.isPending || completeMutation.isPending
            || startWorkMutation.isPending || stopWorkMutation.isPending,
        error, clearError: () => setError(null),
        work,
        toSort: blocks.data?.filter(block => !block.running) ?? [],
        startWork: () => startWorkMutation.mutate(undefined, {
            onError: e => setError(describeError(e, 'Could not start work.')),
        }),
        stopWork,
        sort: block => openSort({ block }),
        longSession: long && { header: long.header, seconds: long.session.seconds },
        splitLongSession: () => {
            if (long) openSort({ session: long.session });
            setLong(null);
        },
        dismissLongSession: () => setLong(null),
    };
}
