/**
 * WP-11 / manual placement of a task (drag, resize -> PATCH start_date +
 * is_fixed [+ duration]).
 *
 * Optimistic and *sticky*: the task is pinned in the task list the instant it
 * is dropped, so the card stays exactly where the user put it, and planning
 * light (README: Planning light) moves the planned tasks it now covers along
 * at once — no re-plan. A rejected placement rolls the task list back and
 * surfaces the server's message as a toast.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

import { updateTask } from '../api';
import { queryKeys } from '../queries';
import type { Task, TaskWrite, TrackingBlockedError } from '../types';
import { minutesToDurationString } from '../utils/duration';

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
        { previous: Task[] | undefined }
    >({
        mutationFn: ({ taskId, start, durationMinutes }) => updateTask(taskId, patchOf(start, durationMinutes)),
        onMutate: async ({ taskId, start, durationMinutes }) => {
            await client.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = client.getQueryData<Task[]>(queryKeys.tasks);
            if (previous) {
                const patch = patchOf(start, durationMinutes);
                client.setQueryData<Task[]>(queryKeys.tasks, previous.map(task => (task.id === taskId
                    ? { ...task, start_date: patch.start_date!, is_fixed: true, ...(patch.duration ? { duration: patch.duration } : {}) }
                    : task)));
            }
            return { previous };
        },
        onError: (error, _vars, context) => {
            if (context?.previous) client.setQueryData(queryKeys.tasks, context.previous);
            setToast(error.response?.data?.detail ?? 'Could not place the task there.');
        },
        onSettled: () => { client.invalidateQueries({ queryKey: queryKeys.tasks }); },
    });

    const placeTask = useCallback(
        (taskId: string, start: Date, durationMinutes?: number) =>
            mutation.mutate({ taskId, start, durationMinutes }),
        [mutation],
    );

    const clearToast = useCallback(() => setToast(null), []);
    return { placeTask, toast, clearToast, placing: mutation.isPending };
}

function patchOf(start: Date, durationMinutes?: number): TaskWrite {
    const patch: TaskWrite = { start_date: start.toISOString(), is_fixed: true };
    if (durationMinutes !== undefined) patch.duration = minutesToDurationString(durationMinutes);
    return patch;
}
