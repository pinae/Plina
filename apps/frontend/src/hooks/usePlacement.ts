/**
 * WP-11 / manual placement of a task (drag, resize -> PATCH start_date +
 * is_fixed [+ duration]).
 *
 * Optimistic and *sticky*: the plan cache is updated the instant the task is
 * dropped, so the card stays exactly where the user put it instead of snapping
 * back while the server responds (a snap-back reads as "the system rejected
 * my edit"). Auto-planned tasks the move now overlaps are faded immediately —
 * they will be re-planned anyway. A rejected placement rolls the cache back to
 * the pre-drag snapshot and surfaces the server's message as a toast.
 *
 * The plan is intentionally *not* invalidated on success: refetching would
 * return the still-stale accepted plan and undo the optimistic placement. The
 * next "Plan my week" (or completion) recomputes the plan for real.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

import { updateTask } from '../api';
import { queryKeys } from '../queries';
import type { PlanResponse, TaskWrite, TrackingBlockedError } from '../types';
import { minutesToDurationString } from '../utils/duration';
import { applyPlacement, findItemDurationSeconds } from '../utils/planPlacement';

interface PlacementVars {
    taskId: string;
    start: Date;
    durationMinutes?: number;
}

export function usePlacement() {
    const client = useQueryClient();
    const [toast, setToast] = useState<string | null>(null);

    const mutation = useMutation<
        unknown,
        AxiosError<TrackingBlockedError>,
        PlacementVars,
        { previous: PlanResponse | undefined }
    >({
        mutationFn: ({ taskId, start, durationMinutes }) => {
            const patch: TaskWrite = { start_date: start.toISOString(), is_fixed: true };
            if (durationMinutes !== undefined) patch.duration = minutesToDurationString(durationMinutes);
            return updateTask(taskId, patch);
        },
        onMutate: async ({ taskId, start, durationMinutes }) => {
            await client.cancelQueries({ queryKey: queryKeys.plan });
            const previous = client.getQueryData<PlanResponse>(queryKeys.plan);
            if (previous) {
                const seconds = durationMinutes !== undefined
                    ? durationMinutes * 60
                    : findItemDurationSeconds(previous, taskId) ?? 3600;
                client.setQueryData<PlanResponse>(
                    queryKeys.plan,
                    applyPlacement(previous, taskId, start.toISOString(), seconds),
                );
            }
            return { previous };
        },
        onError: (error, _vars, context) => {
            if (context?.previous) client.setQueryData(queryKeys.plan, context.previous);
            setToast(error.response?.data?.detail ?? 'Could not place the task there.');
        },
        // Keep the optimistic plan; only the task list needs server truth.
        onSuccess: () => { client.invalidateQueries({ queryKey: queryKeys.tasks }); },
    });

    const placeTask = useCallback(
        (taskId: string, start: Date, durationMinutes?: number) =>
            mutation.mutate({ taskId, start, durationMinutes }),
        [mutation],
    );

    const clearToast = useCallback(() => setToast(null), []);
    return { placeTask, toast, clearToast, placing: mutation.isPending };
}
