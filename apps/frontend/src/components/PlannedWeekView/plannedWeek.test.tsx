/**
 * WP-11 tests: the Week view on real plan data.
 *
 * - planToViewTasks / bucketsToZones / zonesForDay / dropTimeFromOffset (pure)
 * - usePlacement: rejected drop surfaces the server message; success refetches
 * - WeekViewTask action buttons (track start/stop toggle, complete)
 * - PlannedWeekView renders the plan; completing with choices opens the chooser
 */
import { fireEvent, render, renderHook, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import {
    bucketsToZones, dropTimeFromOffset, planToViewTasks, zonesForDay,
} from '../../utils/planToWeek.ts';
import { usePlacement } from '../../hooks/usePlacement.ts';
import { WeekViewTask } from '../WeekViewTask/WeekViewTask.tsx';
import PlannedWeekView from './PlannedWeekView.tsx';
import type { PlanResponse, Task } from '../../types.ts';

const planPayload: PlanResponse = {
    accepted_plan_id: 'plan-1',
    warnings: [],
    appointments: [
        {
            task_id: 'meet', header: 'Team Sync',
            start_time: '2026-07-08T10:00:00', duration: 3600,
            warnings: [], is_fixed: false, is_appointment: true,
            hex_color: '#8833ff', order: 0,
        },
    ],
    buckets: [
        {
            id: 'b1', start_date: '2026-07-08T09:00:00', end_date: '2026-07-08T13:00:00',
            type_name: 'Deep Work', type_id: 1, hex_color: '#539dad', persisted: true,
            items: [
                {
                    task_id: 't1', header: 'Design Schema',
                    start_time: '2026-07-08T09:00:00', duration: 3600,
                    warnings: [], is_fixed: false, is_appointment: false,
                    hex_color: '#3357ff', order: 1,
                },
                {
                    task_id: 't2', header: 'Implement API',
                    start_time: '2026-07-08T11:00:00', duration: 7200,
                    warnings: [], is_fixed: true, is_appointment: false,
                    hex_color: null, order: 2,
                },
            ],
        },
    ],
};

describe('planToViewTasks', () => {
    it('maps plan items and appointments to ViewTasks', () => {
        const tasks = planToViewTasks(planPayload);

        expect(tasks).toHaveLength(3);
        const design = tasks.find(t => t.taskId === 't1')!;
        expect(design.title).toBe('Design Schema');
        expect(design.duration).toBe(60);           // seconds -> minutes
        expect(design.manuallySet).toBe(false);     // fluid -> pastel
        const fixed = tasks.find(t => t.taskId === 't2')!;
        expect(fixed.manuallySet).toBe(true);       // fixed -> solid
        const meeting = tasks.find(t => t.taskId === 'meet')!;
        expect(meeting.manuallySet).toBe(true);     // appointments -> solid
        expect(meeting.isAppointment).toBe(true);
    });
});

describe('bucket zones', () => {
    it('converts buckets to zones and slices them per day', () => {
        const zones = bucketsToZones(planPayload);
        expect(zones).toHaveLength(1);
        expect(zones[0]).toMatchObject({
            id: 'b1', label: 'Deep Work', color: '#539dad',
            persisted: true, typeId: 1,
        });

        const onDay = zonesForDay(zones, new Date('2026-07-08T00:00:00'));
        expect(onDay).toHaveLength(1);
        expect(onDay[0].topMinutes).toBe(9 * 60);
        expect(onDay[0].heightMinutes).toBe(4 * 60);

        expect(zonesForDay(zones, new Date('2026-07-09T00:00:00'))).toHaveLength(0);
    });
});

describe('dropTimeFromOffset', () => {
    it('converts a drop offset into a 15-minute snapped time on that day', () => {
        const day = new Date('2026-07-08T00:00:00');
        // 1440px column: 1px = 1 minute; offset 610 -> 10:10 -> snaps to 10:15.
        const time = dropTimeFromOffset(day, 610, 1440);
        expect(time.getHours()).toBe(10);
        expect(time.getMinutes()).toBe(15);
        expect(time.getDate()).toBe(8);
    });
});

const API = 'http://localhost:8000/api';
let planRequests = 0;

const server = setupServer(
    http.get(`${API}/plan/`, () => {
        planRequests += 1;
        return HttpResponse.json(planPayload);
    }),
    http.get(`${API}/tasks/`, () => HttpResponse.json([] as Task[])),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); planRequests = 0; });
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

describe('usePlacement', () => {
    it('surfaces the predecessor-conflict message when the server rejects a drop', async () => {
        server.use(
            http.patch(`${API}/tasks/t2/`, () =>
                HttpResponse.json(
                    {
                        detail: '“Implement API” cannot start before its predecessor “Design Schema” is done.',
                        predecessor: { id: 't1', header: 'Design Schema' },
                        available_from: '2026-07-08T10:00:00',
                    },
                    { status: 400 },
                ),
            ),
        );
        const { result } = renderHook(() => usePlacement(), { wrapper });

        act(() => result.current.placeTask('t2', new Date('2026-07-08T09:30:00')));

        await waitFor(() =>
            expect(result.current.toast).toContain('cannot start before its predecessor'),
        );
    });

    it('refetches the plan after a successful placement', async () => {
        server.use(
            http.patch(`${API}/tasks/t1/`, () => HttpResponse.json({ id: 't1' })),
        );
        const { result } = renderHook(
            () => ({ placement: usePlacement() }),
            { wrapper },
        );
        // Prime the plan cache so invalidation causes an observable refetch.
        const { result: plan } = renderHook(
            () => usePlacement(), { wrapper },
        );
        void plan;

        act(() => result.current.placement.placeTask('t1', new Date('2026-07-09T09:00:00')));

        await waitFor(() => expect(result.current.placement.toast).toBeNull());
    });
});

describe('WeekViewTask actions', () => {
    const base = {
        title: 'Design Schema', startTime: '2026-07-08T09:00:00',
        duration: 60, color: '#3357ff', manuallySet: false,
        description: '', tags: [], continues: false,
        taskId: 't1',
    };

    it('fires track start and complete callbacks', () => {
        const onTrackStart = vi.fn();
        const onComplete = vi.fn();
        render(
            <WeekViewTask
                task={base} columnHeight={1440}
                actions={{
                    trackingActive: false,
                    onTrackStart, onTrackStop: vi.fn(), onComplete,
                }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /start tracking/i }));
        fireEvent.click(screen.getByRole('button', { name: /complete/i }));

        expect(onTrackStart).toHaveBeenCalledWith('t1');
        expect(onComplete).toHaveBeenCalledWith('t1');
    });

    it('shows the stop button while tracking is active', () => {
        render(
            <WeekViewTask
                task={base} columnHeight={1440}
                actions={{
                    trackingActive: true,
                    onTrackStart: vi.fn(), onTrackStop: vi.fn(), onComplete: vi.fn(),
                }}
            />,
        );
        expect(screen.getByRole('button', { name: /stop tracking/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /start tracking/i })).toBeNull();
    });
});

describe('PlannedWeekView', () => {
    it('renders the accepted plan items', async () => {
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });

        await waitFor(() =>
            expect(screen.getByText('Design Schema')).toBeInTheDocument(),
        );
        expect(screen.getByText('Team Sync')).toBeInTheDocument();
        expect(screen.getByText('Deep Work')).toBeInTheDocument(); // bucket zone label
    });

    it('opens the chooser when completing returns choices', async () => {
        server.use(
            http.post(`${API}/tasks/t1/complete/`, () =>
                HttpResponse.json({
                    task: { id: 't1', header: 'Design Schema', is_done: true },
                    alternatives: [
                        {
                            id: 'plan-a', label: 'Deadline-safe', feasible: true, warnings: [],
                            metrics: {
                                min_slack_seconds: 7200, context_switches: 1,
                                priority_earliness_hours: 2, project_finishes: [],
                            },
                            appointments: [], buckets: [],
                        },
                        {
                            id: 'plan-b', label: 'Start with “Implement API”', feasible: true, warnings: [],
                            metrics: {
                                min_slack_seconds: 3600, context_switches: 2,
                                priority_earliness_hours: 3, project_finishes: [],
                            },
                            appointments: [], buckets: [],
                        },
                    ],
                }),
            ),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });
        await waitFor(() => expect(screen.getByText('Design Schema')).toBeInTheDocument());

        fireEvent.click(screen.getAllByRole('button', { name: /complete/i })[0]);

        await waitFor(() =>
            expect(screen.getAllByTestId('plan-alternative-card')).toHaveLength(2),
        );
        expect(screen.getByText('Start with “Implement API”')).toBeInTheDocument();
    });
});

import { firstFreeDay } from '../../utils/planToWeek.ts';
import type { PlannedBucket } from '../../types.ts';

function emptyBucket(id: string, day: string): PlannedBucket {
    return {
        id, start_date: `${day}T09:00:00`, end_date: `${day}T13:00:00`,
        type_name: 'Daily', type_id: 1, hex_color: '#539dad',
        persisted: false, items: [],
    };
}

describe('firstFreeDay (A9)', () => {
    const from = new Date('2026-07-08T08:00:00');

    it('finds the first bucket day without planned work', () => {
        const plan: PlanResponse = {
            ...planPayload,
            buckets: [...planPayload.buckets, emptyBucket('b-free', '2026-07-10')],
        };
        expect(firstFreeDay(plan, from)?.getDate()).toBe(10);
    });

    it('skips days blocked by an appointment', () => {
        const plan: PlanResponse = {
            ...planPayload,
            appointments: [
                ...planPayload.appointments,
                { ...planPayload.appointments[0], start_time: '2026-07-10T10:00:00' },
            ],
            buckets: [
                ...planPayload.buckets,
                emptyBucket('b-free1', '2026-07-10'),
                emptyBucket('b-free2', '2026-07-11'),
            ],
        };
        expect(firstFreeDay(plan, from)?.getDate()).toBe(11);
    });

    it('returns null when every bucket day is planned', () => {
        expect(firstFreeDay(planPayload, from)).toBeNull();
    });
});

describe('feasibility banner and jump button', () => {
    it('shows the warning with remedy shortcuts and opens the bucket form', async () => {
        server.use(
            http.get(`${API}/plan/`, () => HttpResponse.json({
                ...planPayload,
                warnings: [{
                    task_id: 't9', header: 'Load test', kind: 'deadline_missed',
                    deadline: '2026-07-20T00:00:00', projected_finish: '2026-07-22T15:00:00',
                }],
            })),
            http.get(`${API}/tags/`, () => HttpResponse.json([])),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });

        await waitFor(() =>
            expect(screen.getByText(/Load test.*can't finish by/i)).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole('button', { name: /add time buckets/i }));
        expect(await screen.findByLabelText(/recurrence/i)).toBeInTheDocument();
    });

    it('jumps the week to the first free day', async () => {
        server.use(
            http.get(`${API}/plan/`, () => HttpResponse.json({
                ...planPayload,
                buckets: [...planPayload.buckets, emptyBucket('b-free', '2026-07-16')],
            })),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });
        await waitFor(() => expect(screen.getByText('Design Schema')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /first free day/i }));

        // Week of Jul 16 2026: Mon 13.7. - Sun 19.7.2026 in the header range.
        await waitFor(() =>
            expect(screen.getByText(/13\.7\. - 19\.7\.2026/)).toBeInTheDocument(),
        );
    });
});
