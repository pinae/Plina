/**
 * WP-7: msw-mocked tests for the typed query/mutation hooks.
 *
 * The handlers mirror the real backend payload shapes (see tasks/api.py);
 * request counting proves the A7 invalidation rule: every mutation
 * invalidates the plan query.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import type { AlternativesResponse, PlanResponse } from './types';
import {
    useAcceptPlan,
    useComputeAlternatives,
    usePlan,
    useStartTracking,
} from './queries';

const API = 'http://localhost:8000/api';

const planPayload: PlanResponse = {
    accepted_plan_id: null,
    appointments: [],
    buckets: [
        {
            id: 'bucket-1',
            start_date: '2026-07-08T09:00:00Z',
            end_date: '2026-07-08T13:00:00Z',
            type_name: 'Daily', type_id: 1, persisted: true,
            hex_color: '#539dad',
            items: [
                {
                    task_id: 'task-1',
                    header: 'Design Schema',
                    start_time: '2026-07-08T09:00:00Z',
                    duration: 7200,
                    warnings: [],
                    is_fixed: false,
                    is_appointment: false,
                    hex_color: null,
                },
            ],
        },
    ],
};

const alternativesPayload: AlternativesResponse = {
    alternatives: [
        {
            id: 'plan-a',
            label: 'Deadline-safe',
            feasible: true,
            warnings: [],
            metrics: {
                min_slack_seconds: 94680,
                context_switches: 3,
                priority_earliness_hours: 5.2,
                project_finishes: [
                    { project_id: 'proj-1', name: 'Webshop', finish: '2026-07-09T11:00:00Z' },
                ],
            },
            appointments: [],
            buckets: planPayload.buckets,
        },
        {
            id: 'plan-b',
            label: 'Start with “Setup React” · Deadline-safe',
            feasible: false,
            warnings: [
                {
                    task_id: 'task-9',
                    header: 'Load Test',
                    kind: 'deadline_missed',
                    deadline: '2026-07-09T00:00:00Z',
                    projected_finish: '2026-07-09T12:00:00Z',
                },
            ],
            metrics: {
                min_slack_seconds: -3600,
                context_switches: 5,
                priority_earliness_hours: 7.0,
                project_finishes: [],
            },
            appointments: [],
            buckets: [],
        },
    ],
};

let planRequests = 0;

const server = setupServer(
    http.get(`${API}/plan/`, () => {
        planRequests += 1;
        return HttpResponse.json(planPayload);
    }),
    http.post(`${API}/plan/alternatives/`, () =>
        HttpResponse.json(alternativesPayload),
    ),
    http.post(`${API}/plans/plan-a/accept/`, () =>
        HttpResponse.json({ id: 'plan-a', label: 'Deadline-safe', is_accepted: true }),
    ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    planRequests = 0;
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

describe('usePlan', () => {
    it('fetches and exposes the typed plan payload', async () => {
        const { result } = renderHook(() => usePlan(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data!.buckets[0].items[0].header).toBe('Design Schema');
        expect(result.current.data!.accepted_plan_id).toBeNull();
    });
});

describe('useComputeAlternatives', () => {
    it('POSTs and returns stored alternatives with ids and metrics', async () => {
        const { result } = renderHook(() => useComputeAlternatives(), { wrapper });

        result.current.mutate();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const alternatives = result.current.data!.alternatives;
        expect(alternatives.map(a => a.id)).toEqual(['plan-a', 'plan-b']);
        expect(alternatives[0].metrics.project_finishes[0].name).toBe('Webshop');
        expect(alternatives[1].feasible).toBe(false);
        expect(alternatives[1].warnings[0].kind).toBe('deadline_missed');
    });
});

describe('useAcceptPlan', () => {
    it('invalidates the plan query after accepting (A7)', async () => {
        const { result } = renderHook(
            () => ({ plan: usePlan(), accept: useAcceptPlan() }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.plan.isSuccess).toBe(true));
        expect(planRequests).toBe(1);

        result.current.accept.mutate('plan-a');
        await waitFor(() => expect(result.current.accept.isSuccess).toBe(true));

        await waitFor(() => expect(planRequests).toBe(2));
    });
});

describe('useStartTracking', () => {
    it('surfaces the 400 payload naming unfinished predecessors', async () => {
        server.use(
            http.post(`${API}/tasks/task-2/track/start/`, () =>
                HttpResponse.json(
                    {
                        detail: 'This task has unfinished predecessors.',
                        predecessors: [{ id: 'task-1', header: 'Design Schema' }],
                    },
                    { status: 400 },
                ),
            ),
        );
        const { result } = renderHook(() => useStartTracking(), { wrapper });

        result.current.mutate('task-2');
        await waitFor(() => expect(result.current.isError).toBe(true));

        const payload = result.current.error!.response?.data;
        expect(payload?.predecessors?.[0].header).toBe('Design Schema');
    });
});
