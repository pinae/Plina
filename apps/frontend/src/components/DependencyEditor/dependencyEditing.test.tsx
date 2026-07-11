/**
 * WP-9 tests: editing the dependency graph.
 *
 * - optimistic insert + rollback on the server's cycle 400 (hook level)
 * - cycle path + toast exposed by useDependencyEditing
 * - created edges survive a "reload" (refetch returns the server edge)
 * - edge deletion calls the API
 * - applyCycleHighlight marks nodes and the connecting edges
 * - AddTaskDialog posts a new task
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { useDependencies, useCreateDependency } from '../../queries.tsx';
import { useDependencyEditing } from '../../hooks/useDependencyEditing.ts';
import { applyCycleHighlight, buildFlowGraph } from '../../utils/dependencyGraph.ts';
import { TaskNodeCard } from '../TaskNode/TaskNode.tsx';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';
import type { Dependency, Task } from '../../types.ts';

const API = 'http://localhost:8000/api';

const serverEdges: Dependency[] = [
    { id: 'd1', predecessor: 't1', successor: 't2' },
];

function task(id: string, header: string): Task {
    return {
        id, header, description: '', start_date: null, duration: '01:00:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 5,
        tags: [], hex_color: null, is_fixed: false, is_appointment: false,
        completed_at: null, is_done: false, active_tracking_start: null,
        project_id: null,
    };
}

let createdTasks: unknown[] = [];

const server = setupServer(
    http.get(`${API}/dependencies/`, () => HttpResponse.json(serverEdges)),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.get(`${API}/projects/`, () => HttpResponse.json([])),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = await request.json();
        createdTasks.push(body);
        return HttpResponse.json(task('t-new', (body as { header: string }).header), { status: 201 });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    createdTasks = [];
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCreateDependency (optimistic)', () => {
    it('inserts optimistically and rolls back on the cycle 400', async () => {
        server.use(
            http.post(`${API}/dependencies/`, async () => {
                await delay(80);
                return HttpResponse.json(
                    {
                        detail: 'This dependency would create a cycle.',
                        cycle: ['t1', 't2', 't1'],
                    },
                    { status: 400 },
                );
            }),
        );
        const { result } = renderHook(
            () => ({ deps: useDependencies(), create: useCreateDependency() }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.deps.isSuccess).toBe(true));
        expect(result.current.deps.data).toHaveLength(1);

        act(() => {
            result.current.create.mutate({ predecessor: 't2', successor: 't1' });
        });

        // Optimistic entry appears immediately, before the server answers.
        await waitFor(() => expect(result.current.deps.data).toHaveLength(2));
        expect(
            result.current.deps.data!.some(d => d.id.startsWith('optimistic-')),
        ).toBe(true);

        // Rollback once the 400 arrives.
        await waitFor(() => expect(result.current.create.isError).toBe(true));
        await waitFor(() => expect(result.current.deps.data).toHaveLength(1));
        expect(result.current.deps.data![0].id).toBe('d1');
    });

    it('created edges survive a reload: refetch returns the server edge', async () => {
        let stored: Dependency[] = [...serverEdges];
        server.use(
            http.get(`${API}/dependencies/`, () => HttpResponse.json(stored)),
            http.post(`${API}/dependencies/`, async ({ request }) => {
                const body = (await request.json()) as { predecessor: string; successor: string };
                const created = { id: 'd2', ...body };
                stored = [...stored, created];
                return HttpResponse.json(created, { status: 201 });
            }),
        );
        const { result } = renderHook(
            () => ({ deps: useDependencies(), create: useCreateDependency() }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.deps.isSuccess).toBe(true));

        act(() => {
            result.current.create.mutate({ predecessor: 't2', successor: 't3' });
        });
        await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

        // After invalidation the cache holds the persisted edge, not the optimistic one.
        await waitFor(() => {
            const ids = result.current.deps.data!.map(d => d.id);
            expect(ids).toContain('d2');
            expect(ids.every(id => !id.startsWith('optimistic-'))).toBe(true);
        });
    });
});

describe('useDependencyEditing', () => {
    it('exposes the cycle path and a toast message after a rejected connect', async () => {
        server.use(
            http.post(`${API}/dependencies/`, () =>
                HttpResponse.json(
                    {
                        detail: 'This dependency would create a cycle.',
                        cycle: ['t1', 't2', 't1'],
                    },
                    { status: 400 },
                ),
            ),
        );
        const { result } = renderHook(() => useDependencyEditing(), { wrapper });

        act(() => {
            result.current.onConnect({
                source: 't2', target: 't1', sourceHandle: null, targetHandle: null,
            });
        });

        await waitFor(() => expect(result.current.cyclePath).toEqual(['t1', 't2', 't1']));
        expect(result.current.toast).toContain('cycle');
    });

    it('ignores self-connections without calling the API', async () => {
        const { result } = renderHook(() => useDependencyEditing(), { wrapper });
        act(() => {
            result.current.onConnect({
                source: 't1', target: 't1', sourceHandle: null, targetHandle: null,
            });
        });
        // onUnhandledRequest: 'error' would fail the test if a POST went out.
        expect(result.current.cyclePath).toBeNull();
    });

    it('deletes selected edges through the API', async () => {
        const deleted: string[] = [];
        server.use(
            http.delete(`${API}/dependencies/d1/`, () => {
                deleted.push('d1');
                return new HttpResponse(null, { status: 204 });
            }),
        );
        const { result } = renderHook(() => useDependencyEditing(), { wrapper });

        act(() => {
            result.current.onEdgesDelete([
                { id: 'd1', source: 't1', target: 't2' },
            ]);
        });

        await waitFor(() => expect(deleted).toEqual(['d1']));
    });
});

describe('applyCycleHighlight', () => {
    it('marks cycle nodes and the edges between consecutive cycle members', () => {
        const tasks = [task('t1', 'A'), task('t2', 'B'), task('t3', 'C')];
        const deps = [
            { id: 'd1', predecessor: 't1', successor: 't2' },
            { id: 'd2', predecessor: 't2', successor: 't3' },
        ];
        const graph = buildFlowGraph(tasks, deps, []);

        const highlighted = applyCycleHighlight(graph.nodes, graph.edges, ['t1', 't2', 't1']);

        const inCycle = Object.fromEntries(
            highlighted.nodes.map(n => [n.id, n.data.inCycle ?? false]),
        );
        expect(inCycle).toEqual({ t1: true, t2: true, t3: false });
        const d1 = highlighted.edges.find(e => e.id === 'd1')!;
        const d2 = highlighted.edges.find(e => e.id === 'd2')!;
        expect(d1.style?.stroke).toBeDefined();
        expect(d2.style?.stroke).toBeUndefined();
    });
});

describe('TaskNodeCard cycle state', () => {
    it('is visually flagged when part of a cycle', () => {
        render(
            <TaskNodeCard
                header="A" durationLabel="1h" projectColor={null}
                projectName={null} isDone={false} inCycle={true}
            />,
        );
        expect(screen.getByTestId('task-node-card')).toHaveAttribute(
            'data-in-cycle', 'true',
        );
    });
});

describe('TaskFormDialog (create path from the editor)', () => {
    it('creates a task with the entered header', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });

        fireEvent.change(screen.getByLabelText(/header/i), {
            target: { value: 'Write tests' },
        });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(createdTasks).toHaveLength(1));
        expect(createdTasks[0]).toMatchObject({ header: 'Write tests' });
    });
});
