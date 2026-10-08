/**
 * WP-7: TanStack Query layer.
 *
 * Invalidation rule (A7): every mutation that can change the schedule
 * invalidates the plan query — the plan on screen must never be stale.
 * Task/dependency mutations additionally invalidate their own lists.
 */
import {
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import type { AxiosError } from 'axios';

import {
    acceptPlan,
    completeTask,
    moveTask,
    computeAlternatives,
    createBucketType,
    changePassword,
    createDependency,
    createTag,
    createTask,
    deleteDependency,
    deleteTask,
    fetchBucketTypes,
    fetchDependencies,
    fetchSession,
    login,
    logout,
    fetchPlan,
    recalculatePlan,
    fetchSettings,
    fetchTags,
    fetchTasks,
    reopenTask,
    splitTask,
    startTracking,
    stopTracking,
    updateBucketType,
    updateSettings,
    updateTag,
    updateTask,
    convertMarker,
    createCalendar,
    createMarker,
    deleteBucketType,
    deleteCalendar,
    deleteMarker,
    fetchCalendars,
    fetchMarkers,
    mergeTasks,
    syncCalendars,
    updateCalendar,
    updateMarker,
    fetchTimeSheet,
    deleteTag,
    fetchSessions,
    createSession,
    updateSession,
    deleteSession,
    fetchSavedFilters,
    createSavedFilter,
    updateSavedFilter,
    deleteSavedFilter,
} from './api';
import type {
    BucketTypeWrite, CalendarSubscriptionWrite, Dependency, DependencyCycleError, MarkerWrite, SavedFilterWrite,
    SettingsWrite,
    SplitRequest, TagWrite, Task, TaskWrite, TrackedSessionWrite, TrackingBlockedError, UserSettings,
} from './types';
import { applyMove } from './utils/treeDnd.ts';
import { goTo } from './utils/navigation.ts';

export const queryKeys = {
    plan: ['plan'] as const,
    tasks: ['tasks'] as const,
    dependencies: ['dependencies'] as const,
    tags: ['tags'] as const,
    bucketTypes: ['bucketTypes'] as const,
    settings: ['settings'] as const,
    session: ['session'] as const,
    markers: ['markers'] as const,
    calendars: ['calendars'] as const,
    timeSheet: ['timesheet'] as const,
    sessions: ['sessions'] as const,
    savedFilters: ['savedFilters'] as const,
};

/** Other devices pick up a changed active project this often (§3.1). */
export const SETTINGS_REFRESH_MS = 30_000;

// ----------------------------------------------------------------- session

/** Who is logged in (README: Accounts); fetched once, then kept up to date
 *  by the login, the logout and every 401 (AuthGate). */
export const useSession = () =>
    useQuery({ queryKey: queryKeys.session, queryFn: fetchSession, staleTime: Infinity, retry: 1 });

/** Another user may log in on this device: nothing of the previous one's
 *  data may stay in the cache. */
const forgetEverythingButTheSession = (client: ReturnType<typeof useQueryClient>) =>
    client.removeQueries({ predicate: query => query.queryKey[0] !== queryKeys.session[0] });

export const useLogin = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: login,
        onSuccess: session => {
            forgetEverythingButTheSession(client);
            client.setQueryData(queryKeys.session, session);
        },
    });
};

export const useLogout = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: logout,
        onSuccess: async ({ redirect }) => {
            forgetEverythingButTheSession(client);
            // Logged in with the single sign-on: log out there too.
            if (redirect) goTo(redirect);
            else await client.refetchQueries({ queryKey: queryKeys.session });
        },
    });
};

export const useChangePassword = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: changePassword,
        onSuccess: session => client.setQueryData(queryKeys.session, session),
    });
};

// ----------------------------------------------------------------- queries

export const usePlan = () =>
    useQuery({ queryKey: queryKeys.plan, queryFn: fetchPlan });

export const useTasks = () =>
    useQuery({ queryKey: queryKeys.tasks, queryFn: fetchTasks });

export const useDependencies = () =>
    useQuery({ queryKey: queryKeys.dependencies, queryFn: fetchDependencies });

export const useTags = () =>
    useQuery({ queryKey: queryKeys.tags, queryFn: fetchTags });


export const useBucketTypes = () =>
    useQuery({ queryKey: queryKeys.bucketTypes, queryFn: fetchBucketTypes });

/** UI-3 settings (active project, default duration), synced across devices. */
export const useSettings = () =>
    useQuery({
        queryKey: queryKeys.settings, queryFn: fetchSettings,
        refetchOnWindowFocus: true, refetchInterval: SETTINGS_REFRESH_MS,
    });

// --------------------------------------------------------------- mutations

function useInvalidate() {
    const client = useQueryClient();
    return (...keys: (readonly string[])[]) =>
        Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })));
}

/** POST /plan/alternatives/ — stores candidates; the plan itself is unchanged
 *  until one of them is accepted, so nothing is invalidated here. */
export const useComputeAlternatives = () =>
    useMutation({ mutationFn: computeAlternatives });

/** "Re-plan": the answer is the new plan. */
export const useReplan = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: recalculatePlan,
        onSuccess: plan => client.setQueryData(queryKeys.plan, plan),
    });
};

export const useAcceptPlan = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: acceptPlan,
        onSuccess: () => invalidate(queryKeys.plan),
    });
};

/** Every start point (Week view ▶, header, shortcut T) goes through here:
 *  the server switches the running session over and makes the task's
 *  project active; the response carries the new settings. */
export const useStartTracking = () => {
    const invalidate = useInvalidate();
    const client = useQueryClient();
    return useMutation<
        Awaited<ReturnType<typeof startTracking>>,
        AxiosError<TrackingBlockedError>,
        string
    >({
        mutationFn: startTracking,
        onSuccess: data => {
            if (data.settings) client.setQueryData<UserSettings>(queryKeys.settings, data.settings);
            return invalidate(queryKeys.tasks, queryKeys.timeSheet, queryKeys.sessions);
        },
    });
};

/** The split editor's atomic save (UI-3/UI-6). */
export const useSplitTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ taskId, body }: { taskId: string; body: SplitRequest }) => splitTask(taskId, body),
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.dependencies),
    });
};

export const useUpdateSettings = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (patch: SettingsWrite) => updateSettings(patch),
        onSuccess: data => client.setQueryData<UserSettings>(queryKeys.settings, data),
    });
};

export const useStopTracking = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: stopTracking,
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.timeSheet, queryKeys.sessions),
    });
};

/** Parents may complete too, and a completed active project hands over; the
 *  plan is not touched (README: Planning light). */
export const useCompleteTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: completeTask,
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.settings, queryKeys.timeSheet, queryKeys.sessions),
    });
};

/** Undo a completion; completed ancestors reopen too (UI-2). */
export const useReopenTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: reopenTask,
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.settings),
    });
};

export const useCreateTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createTask,
        onSuccess: () => invalidate(queryKeys.tasks),
    });
};

export const useUpdateTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskWrite }) =>
            updateTask(taskId, patch),
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.timeSheet, queryKeys.sessions),
    });
};

/** T-5: set a task's priority — shown at once (optimistic), rolled back
 *  if the server refuses; the plan follows after the save. */
export const useSetPriority = () => {
    const client = useQueryClient();
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ taskId, priority }: { taskId: string; priority: number }) =>
            updateTask(taskId, { priority }),
        onMutate: ({ taskId, priority }) => {
            void client.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = client.getQueryData<Task[]>(queryKeys.tasks);
            client.setQueryData<Task[]>(queryKeys.tasks,
                list => list?.map(t => (t.id === taskId ? { ...t, priority } : t)));
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) client.setQueryData(queryKeys.tasks, context.previous);
        },
        onSettled: () => invalidate(queryKeys.tasks),
    });
};

/** T-6: move a task (drag and drop, Tab, Alt+↑/↓) — the tree changes at
 *  once (optimistic) and is rolled back if the server refuses. */
export const useMoveTask = () => {
    const client = useQueryClient();
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ taskId, parentId, index }: { taskId: string; parentId: string | null; index: number }) =>
            moveTask(taskId, parentId, index),
        onMutate: ({ taskId, parentId, index }) => {
            void client.cancelQueries({ queryKey: queryKeys.tasks });
            const previous = client.getQueryData<Task[]>(queryKeys.tasks);
            if (previous) client.setQueryData<Task[]>(queryKeys.tasks, applyMove(previous, taskId, parentId, index));
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) client.setQueryData(queryKeys.tasks, context.previous);
        },
        // The active project may hand over (T-1).
        onSettled: () => invalidate(queryKeys.tasks, queryKeys.settings),
    });
};

export const useDeleteTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ taskId, children, occurrences }: {
            taskId: string; children?: 'lift' | 'delete'; occurrences?: 'all';
        }) => deleteTask(taskId, children, occurrences),
        onSuccess: () =>
            invalidate(queryKeys.tasks, queryKeys.dependencies, queryKeys.timeSheet, queryKeys.sessions),
    });
};

export const useCreateDependency = () => {
    const client = useQueryClient();
    return useMutation<
        Awaited<ReturnType<typeof createDependency>>,
        AxiosError<DependencyCycleError>,
        { predecessor: string; successor: string },
        { previous: Dependency[] | undefined }
    >({
        mutationFn: createDependency,
        // Optimistic: the edge appears in the graph immediately; a rejected
        // request (e.g. cycle) rolls the cache back to the snapshot.
        onMutate: async edge => {
            await client.cancelQueries({ queryKey: queryKeys.dependencies });
            const previous = client.getQueryData<Dependency[]>(queryKeys.dependencies);
            const optimistic: Dependency = {
                id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                ...edge,
            };
            client.setQueryData<Dependency[]>(
                queryKeys.dependencies,
                (current = []) => [...current, optimistic],
            );
            return { previous };
        },
        onError: (_error, _edge, context) => {
            client.setQueryData(queryKeys.dependencies, context?.previous);
        },
        onSettled: () =>
            Promise.all([
                client.invalidateQueries({ queryKey: queryKeys.dependencies }),
            ]),
    });
};

export const useDeleteDependency = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteDependency,
        onSuccess: () => invalidate(queryKeys.dependencies),
    });
};

export const useCreateTag = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createTag,
        onSuccess: () => invalidate(queryKeys.tags),
    });
};

export const useUpdateTag = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Partial<TagWrite> }) =>
            updateTag(id, patch),
        // Tag colour/affinity can influence planning, so refresh the plan too.
        onSuccess: () => invalidate(queryKeys.tags),
    });
};

/** Its tasks and time buckets lose it: they and the plan are fetched again. */
export const useDeleteTag = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteTag,
        onSuccess: () => invalidate(queryKeys.tags, queryKeys.tasks, queryKeys.bucketTypes),
    });
};

export const useCreateBucketType = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createBucketType,
        // A7: new recurring capacity changes what can be planned; the list
        // pane must also show the freshly created type.
        onSuccess: () => invalidate(queryKeys.plan, queryKeys.bucketTypes),
    });
};

export const useUpdateBucketType = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ id, patch }: { id: number; patch: Partial<BucketTypeWrite> }) =>
            updateBucketType(id, patch),
        // A7: changed recurring capacity changes what can be planned.
        onSuccess: () => invalidate(queryKeys.plan, queryKeys.bucketTypes),
    });
};

// ------------------------------------------------------- calendar (README: Calendar)

export const useMarkers = () =>
    useQuery({ queryKey: queryKeys.markers, queryFn: fetchMarkers });

/** Markers move named deadlines: tasks and the plan follow. */
export const useCreateMarker = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createMarker,
        onSuccess: () => invalidate(queryKeys.markers),
    });
};

export const useUpdateMarker = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: MarkerWrite }) => updateMarker(id, patch),
        onSuccess: () => invalidate(queryKeys.markers, queryKeys.tasks),
    });
};

export const useDeleteMarker = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteMarker,
        onSuccess: () => invalidate(queryKeys.markers, queryKeys.tasks),
    });
};

/** The marker becomes a special bucket: new capacity, the regular buckets give way. */
export const useConvertMarker = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ id, bucketType }: { id: string; bucketType: Partial<BucketTypeWrite> }) =>
            convertMarker(id, bucketType),
        onSuccess: () => invalidate(queryKeys.markers, queryKeys.bucketTypes, queryKeys.tasks, queryKeys.plan),
    });
};

export const useDeleteBucketType = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteBucketType,
        onSuccess: () => invalidate(queryKeys.bucketTypes, queryKeys.plan),
    });
};

export const useCalendars = () =>
    useQuery({ queryKey: queryKeys.calendars, queryFn: fetchCalendars });

/** Everything a read of the calendars can change. */
const CALENDAR_DATA = [queryKeys.calendars, queryKeys.tasks, queryKeys.markers, queryKeys.bucketTypes,
    queryKeys.plan] as const;

export const useCreateCalendar = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createCalendar,
        onSuccess: () => invalidate(...CALENDAR_DATA),
    });
};

export const useUpdateCalendar = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: CalendarSubscriptionWrite }) => updateCalendar(id, patch),
        onSuccess: () => invalidate(...CALENDAR_DATA),
    });
};

export const useDeleteCalendar = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteCalendar,
        onSuccess: () => invalidate(...CALENDAR_DATA),
    });
};

/** "Read now": every calendar, at once. */
export const useSyncCalendars = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: () => syncCalendars(true),
        onSuccess: () => invalidate(...CALENDAR_DATA),
    });
};

/** How often the open app asks for the calendars to be read (the server
 *  reads one at most every 10 minutes). */
export const CALENDAR_SYNC_MS = 5 * 60_000;

/** Keeps the calendars read while the app is open (README: Calendar): when
 *  it opens and every few minutes; what changed is fetched again. */
export function useCalendarSync(enabled = true) {
    const client = useQueryClient();
    useQuery({
        queryKey: ['calendar-sync'],
        queryFn: async () => {
            const result = await syncCalendars();
            if (result.changed) {
                await Promise.all(CALENDAR_DATA.map(queryKey => client.invalidateQueries({ queryKey })));
            } else {
                client.setQueryData(queryKeys.calendars, result.calendars);
            }
            return result;
        },
        enabled,
        refetchInterval: CALENDAR_SYNC_MS,
        refetchOnWindowFocus: false,
        retry: false,
    });
}

/** Merge another task into one (README: Calendar). */
export const useMergeTasks = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ keptId, otherId, values }: { keptId: string; otherId: string; values: TaskWrite }) =>
            mergeTasks(keptId, otherId, values),
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.dependencies, queryKeys.settings, queryKeys.timeSheet, queryKeys.sessions),
    });
};

// ------------------------------------------------------------ time sheet

/** While work is being tracked, the time sheet follows the clock. */
export const TIME_SHEET_RUNNING_REFRESH_MS = 60_000;

/** The time sheet (README: Time sheet) from ``from`` to ``to`` (YYYY-MM-DD). */
export const useTimeSheet = (from: string, to: string) =>
    useQuery({
        queryKey: [...queryKeys.timeSheet, from, to],
        queryFn: () => fetchTimeSheet(from, to),
        refetchInterval: query => (query.state.data?.days.some(day => day.running)
            ? TIME_SHEET_RUNNING_REFRESH_MS : false),
    });

// ---------------------------------------------------------- tracked time

/** Tracked time of a task (``task``) or begun on days (``from``, ``to``). */
export const useSessions = (params: { task?: string; from?: string; to?: string }) =>
    useQuery({ queryKey: [...queryKeys.sessions, params], queryFn: () => fetchSessions(params) });

/** What a change of tracked time changes: the task's time, the time sheet (the
 *  plan only through planning light, README: Planning light). */
const TRACKED_TIME = [queryKeys.sessions, queryKeys.tasks, queryKeys.timeSheet] as const;

export const useCreateSession = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createSession,
        onSuccess: () => invalidate(...TRACKED_TIME),
    });
};

export const useUpdateSession = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: TrackedSessionWrite }) => updateSession(id, patch),
        onSuccess: () => invalidate(...TRACKED_TIME),
    });
};

export const useDeleteSession = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteSession,
        onSuccess: () => invalidate(...TRACKED_TIME),
    });
};

// ------------------------------------------- saved filters (README: Filtering tasks)

export const useSavedFilters = () =>
    useQuery({ queryKey: queryKeys.savedFilters, queryFn: fetchSavedFilters });

export const useSaveFilter = () => {
    const invalidate = useInvalidate();
    return useMutation({
        /** With an id: that filter is replaced; otherwise a new one. */
        mutationFn: ({ id, ...saved }: SavedFilterWrite & { id?: string }) =>
            (id ? updateSavedFilter(id, saved) : createSavedFilter(saved)),
        onSuccess: () => invalidate(queryKeys.savedFilters),
    });
};

export const useDeleteSavedFilter = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteSavedFilter,
        onSuccess: () => invalidate(queryKeys.savedFilters),
    });
};
