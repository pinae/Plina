/**
 * WP-7: TanStack Query layer.
 *
 * Invalidation rule (A7): every mutation that can change the schedule
 * invalidates the plan query — the plan on screen must never be stale.
 * Task/dependency mutations additionally invalidate their own lists.
 */
import {
    QueryClient,
    QueryClientProvider,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { ReactNode } from 'react';

import {
    acceptPlan,
    completeTask,
    computeAlternatives,
    createBucketType,
    createDependency,
    createProject,
    createTag,
    createTask,
    deleteDependency,
    deleteTask,
    fetchDependencies,
    fetchPlan,
    fetchProjects,
    fetchTags,
    fetchTasks,
    startTracking,
    stopTracking,
    updateTask,
} from './api';
import type { Dependency, DependencyCycleError, TaskWrite, TrackingBlockedError } from './types';

export const queryKeys = {
    plan: ['plan'] as const,
    tasks: ['tasks'] as const,
    dependencies: ['dependencies'] as const,
    tags: ['tags'] as const,
    projects: ['projects'] as const,
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

export const useProjects = () =>
    useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects });

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

export const useAcceptPlan = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: acceptPlan,
        onSuccess: () => invalidate(queryKeys.plan),
    });
};

export const useStartTracking = () => {
    const invalidate = useInvalidate();
    return useMutation<
        Awaited<ReturnType<typeof startTracking>>,
        AxiosError<TrackingBlockedError>,
        string
    >({
        mutationFn: startTracking,
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.plan),
    });
};

export const useStopTracking = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: stopTracking,
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.plan),
    });
};

/** Completing may return fresh choices; consume them from `data.alternatives`. */
export const useCompleteTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: completeTask,
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.plan),
    });
};

export const useCreateTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createTask,
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.plan),
    });
};

export const useUpdateTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskWrite }) =>
            updateTask(taskId, patch),
        onSuccess: () => invalidate(queryKeys.tasks, queryKeys.plan),
    });
};

export const useDeleteTask = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteTask,
        onSuccess: () =>
            invalidate(queryKeys.tasks, queryKeys.dependencies, queryKeys.plan),
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
                client.invalidateQueries({ queryKey: queryKeys.plan }),
            ]),
    });
};

export const useDeleteDependency = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: deleteDependency,
        onSuccess: () => invalidate(queryKeys.dependencies, queryKeys.plan),
    });
};

// ---------------------------------------------------------------- provider

export function createAppQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { staleTime: 10_000, refetchOnWindowFocus: false },
        },
    });
}

const appQueryClient = createAppQueryClient();

export function AppQueryProvider({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={appQueryClient}>
            {children}
        </QueryClientProvider>
    );
}

export const useCreateTag = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createTag,
        onSuccess: () => invalidate(queryKeys.tags),
    });
};

export const useCreateProject = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createProject,
        onSuccess: () => invalidate(queryKeys.projects),
    });
};

export const useCreateBucketType = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: createBucketType,
        // A7: new recurring capacity changes what can be planned.
        onSuccess: () => invalidate(queryKeys.plan),
    });
};
