/**
 * WP-11: manual placement of a task (drag & drop -> PATCH start_date+is_fixed).
 *
 * There is no optimistic move: the card only jumps after the server accepted
 * and the plan refetched.  A rejected placement therefore needs no visual
 * revert — only the server's message as a toast.
 */
import { useCallback, useState } from 'react';
import type { AxiosError } from 'axios';

import { useUpdateTask } from '../queries';
import type { TaskWrite, TrackingBlockedError } from '../types';
import { minutesToDurationString } from '../utils/duration';

export function usePlacement() {
    const update = useUpdateTask();
    const [toast, setToast] = useState<string | null>(null);

    const placeTask = useCallback((taskId: string, start: Date, durationMinutes?: number) => {
        const patch: TaskWrite = { start_date: start.toISOString(), is_fixed: true };
        if (durationMinutes !== undefined) patch.duration = minutesToDurationString(durationMinutes);
        update.mutate(
            { taskId, patch },
            {
                onError: error => {
                    const payload = (error as AxiosError<TrackingBlockedError>)
                        .response?.data;
                    setToast(payload?.detail ?? 'Could not place the task there.');
                },
            },
        );
    }, [update]);

    const clearToast = useCallback(() => setToast(null), []);
    return { placeTask, toast, clearToast, placing: update.isPending };
}
