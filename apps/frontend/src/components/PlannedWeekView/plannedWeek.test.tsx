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
    it('marks the Rest placeholder of a parent (UI-2)', () => {
        const withRest: PlanResponse = {
            ...planPayload,
            buckets: [{
                ...planPayload.buckets[0],
                items: [{
                    task_id: 'hw', header: 'Rest of Hardware Design', is_rest: true,
                    start_time: '2026-07-08T11:00:00', duration: 7200,
                    warnings: [], is_fixed: false, is_appointment: false, hex_color: null,
                }],
            }],
        };
        const rest = planToViewTasks(withRest).find(t => t.taskId === 'hw')!;
        expect(rest.isRest).toBe(true);
        expect(rest.title).toBe('Rest of Hardware Design');
        expect(planToViewTasks(planPayload).every(t => !t.isRest)).toBe(true);
    });

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
const server = setupServer(
    http.get(`${API}/plan/`, () => HttpResponse.json(planPayload)),
    http.get(`${API}/settings/`, () => HttpResponse.json({
        default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
    })),
    http.get(`${API}/tasks/`, () => HttpResponse.json([] as Task[])),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); });
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

    it('opens on the time frame from the settings, filling the view', async () => {
        server.use(http.get(`${API}/settings/`, () => HttpResponse.json({
            default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
            week_view_start: '08:00:00', week_view_end: '16:45:00',
        })));
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });
        const grid = await screen.findByTestId('week-grid');
        // 8:00–16:45 (8.75 h) fills the 720 px jsdom fallback height (less the
        // 8 px margin above the frame's start).
        await waitFor(() => expect(grid).toHaveAttribute('data-column-height', String(Math.round(712 * 1440 / 525))));
    });
});

describe('tracked time over the estimate (UI-8)', () => {
    it('marks the card of a task whose tracked time exceeds its estimate', async () => {
        const base = {
            description: '', start_date: null, latest_finish_date: null, priority: 5, tags: [], hex_color: null,
            is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
        };
        server.use(
            http.get(`${API}/tasks/`, () => HttpResponse.json([
                { ...base, id: 't1', header: 'Design Schema', duration: '01:00:00', time_spent: '01:20:00',
                    active_tracking_start: null },
                { ...base, id: 't2', header: 'Implement API', duration: '02:00:00', time_spent: '00:30:00',
                    active_tracking_start: null },
            ])),
            http.get(`${API}/settings/`, () => HttpResponse.json({
                default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
            })),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });
        const over = await screen.findByTestId('over-estimate');
        expect(over).toHaveTextContent('+20m over');
        expect(screen.getAllByTestId('over-estimate')).toHaveLength(1);
    });
});

describe('completion cascade (UI-8 acceptance)', () => {
    it('completing the last child shows an undo snackbar; Undo reopens the parent', async () => {
        const reopened: string[] = [];
        server.use(
            http.post(`${API}/tasks/t1/complete/`, () => HttpResponse.json({
                task: { id: 't1', header: 'Design Schema', is_done: true }, alternatives: [],
                auto_completed: [{ id: 'hw', header: 'Hardware Design' }],
            })),
            http.post(`${API}/tasks/hw/reopen/`, () => {
                reopened.push('hw');
                return HttpResponse.json({ task: { id: 'hw' }, reopened: ['hw'] });
            }),
            http.get(`${API}/settings/`, () => HttpResponse.json({
                default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
            })),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });
        await waitFor(() => expect(screen.getByText('Design Schema')).toBeInTheDocument());

        fireEvent.click(screen.getAllByRole('button', { name: /complete/i })[0]);

        expect(await screen.findByText('“Hardware Design” completed too')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /undo/i }));
        await waitFor(() => expect(reopened).toEqual(['hw']));
    });
});

describe('Rest placeholder (UI-6)', () => {
    it('opens the split editor of its parent when clicked', async () => {
        const parent: Task = {
            id: 'hw', header: 'Hardware Design', description: '', start_date: null, duration: '12:00:00',
            latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null,
            is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
            active_tracking_start: null, ...treeDefaults, children_ids: ['cad'],
        };
        const child: Task = { ...parent, id: 'cad', header: 'CAD', duration: '03:00:00', children_ids: [], parent_id: 'hw', ancestor_ids: ['hw'] };
        server.use(
            http.get(`${API}/plan/`, () => HttpResponse.json({
                ...planPayload,
                buckets: [{
                    ...planPayload.buckets[0],
                    items: [{
                        task_id: 'hw', header: 'Rest of Hardware Design', is_rest: true,
                        start_time: '2026-07-08T10:00:00', duration: 7200, warnings: [],
                        is_fixed: false, is_appointment: false, hex_color: null,
                    }],
                }],
            })),
            http.get(`${API}/tasks/`, () => HttpResponse.json([parent, child])),
            http.get(`${API}/tags/`, () => HttpResponse.json([])),
            http.get(`${API}/settings/`, () => HttpResponse.json({
                default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
            })),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });
        const card = await screen.findByText('Rest of Hardware Design');
        fireEvent.click(card);
        expect(await screen.findByText('Split “Hardware Design”')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('textbox', { name: /^part 1$/i })).toHaveValue('CAD'));
    });
});

describe('dragging a task (regression: sticky + fades overlaps)', () => {
    it('keeps the dropped task in place and fades the auto task it now overlaps', async () => {
        const patched: Array<Record<string, unknown>> = [];
        server.use(
            http.get(`${API}/plan/`, () => HttpResponse.json({
                accepted_plan_id: 'p1', warnings: [], appointments: [],
                buckets: [{
                    id: 'b1', start_date: '2026-07-08T08:00:00', end_date: '2026-07-08T18:00:00',
                    type_name: 'Work', type_id: 1, hex_color: '#539dad', persisted: true,
                    items: [
                        {
                            task_id: 't-move', header: 'MoveMe', start_time: '2026-07-08T08:00:00',
                            duration: 3600, warnings: [], is_fixed: true, is_appointment: true, hex_color: '#3357ff',
                        },
                        {
                            task_id: 't-other', header: 'OtherAuto', start_time: '2026-07-08T14:00:00',
                            duration: 3600, warnings: [], is_fixed: false, is_appointment: false, hex_color: '#3357ff',
                        },
                    ],
                }],
            })),
            http.patch(`${API}/tasks/t-move/`, async ({ request }) => {
                patched.push((await request.json()) as Record<string, unknown>);
                return HttpResponse.json({ id: 't-move' });
            }),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });

        const card = (await screen.findByText('MoveMe')).closest('[data-testid="week-view-task"]')!;
        // jsdom has no clientHeight, so the column gets the fallback fit height:
        // 1440min in 720px -> 1px = 2min.
        // Drag the appointment down 180px = 360min: 08:00 -> 14:00, over OtherAuto.
        fireEvent.mouseDown(card, { clientY: 200, clientX: 400, button: 0 });
        fireEvent.mouseMove(window, { clientY: 380, clientX: 400 });
        fireEvent.mouseUp(window, { clientY: 380, clientX: 400 });

        // The placement was sent...
        await waitFor(() => expect(patched).toHaveLength(1));
        expect(patched[0]).toMatchObject({ is_fixed: true });

        // ...the dropped appointment stuck at 14:00 (840min = 420px), not snapped back...
        await waitFor(() => {
            const moved = screen.getByText('MoveMe').closest('[data-testid="week-view-task"]')!;
            expect(moved).toHaveStyle({ top: '420px' });
        });
        // ...and the overlapped auto task is invalid (faded to 30%).
        const other = screen.getByText('OtherAuto').closest('[data-testid="week-view-task"]')!;
        expect(other).toHaveStyle({ opacity: '0.3' });
    });
});

describe('dragging a task (regression: live feedback before release)', () => {
    it('fades the overlapped auto task and shows the drag layer while still dragging', async () => {
        const patched: unknown[] = [];
        server.use(
            http.get(`${API}/plan/`, () => HttpResponse.json({
                accepted_plan_id: 'p1', warnings: [], appointments: [],
                buckets: [{
                    id: 'b1', start_date: '2026-07-08T08:00:00', end_date: '2026-07-08T18:00:00',
                    type_name: 'Work', type_id: 1, hex_color: '#539dad', persisted: true,
                    items: [
                        {
                            task_id: 't-move', header: 'MoveMe', start_time: '2026-07-08T08:00:00',
                            duration: 3600, warnings: [], is_fixed: true, is_appointment: true, hex_color: '#3357ff',
                        },
                        {
                            task_id: 't-other', header: 'OtherAuto', start_time: '2026-07-08T14:00:00',
                            duration: 3600, warnings: [], is_fixed: false, is_appointment: false, hex_color: '#3357ff',
                        },
                    ],
                }],
            })),
            http.patch(`${API}/tasks/t-move/`, async ({ request }) => {
                patched.push(await request.json());
                return HttpResponse.json({ id: 't-move' });
            }),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });

        const card = (await screen.findByText('MoveMe')).closest('[data-testid="week-view-task"]')!;
        // Press and drag the appointment down onto OtherAuto — but do NOT release.
        fireEvent.mouseDown(card, { clientY: 200, clientX: 400, button: 0 });
        fireEvent.mouseMove(window, { clientY: 380, clientX: 400 });

        // Live: the overlapped auto task fades and the drag layer appears, before release.
        await waitFor(() => {
            const other = screen.getByText('OtherAuto').closest('[data-testid="week-view-task"]')!;
            expect(other).toHaveStyle({ opacity: '0.3' });
        });
        expect(screen.getByTestId('drag-layer')).toBeInTheDocument();

        fireEvent.mouseUp(window, { clientY: 380, clientX: 400 }); // release to end the drag
        await waitFor(() => expect(patched).toHaveLength(1));
    });
});

describe('dragging an appointment over another appointment', () => {
    it('shrinks the overlapped appointment to half instead of invalidating it', async () => {
        const patched: unknown[] = [];
        server.use(
            http.get(`${API}/plan/`, () => HttpResponse.json({
                accepted_plan_id: 'p1', warnings: [],
                appointments: [
                    {
                        task_id: 'a-move', header: 'DragAppt', start_time: '2026-07-08T08:00:00',
                        duration: 3600, warnings: [], is_fixed: true, is_appointment: true, hex_color: '#8833ff',
                    },
                    {
                        task_id: 'a-other', header: 'OtherAppt', start_time: '2026-07-08T14:00:00',
                        duration: 3600, warnings: [], is_fixed: true, is_appointment: true, hex_color: '#8833ff',
                    },
                ],
                buckets: [],
            })),
            http.patch(`${API}/tasks/a-move/`, async ({ request }) => {
                patched.push(await request.json());
                return HttpResponse.json({ id: 'a-move' });
            }),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });

        const card = (await screen.findByText('DragAppt')).closest('[data-testid="week-view-task"]')!;
        fireEvent.mouseDown(card, { clientY: 200, clientX: 400, button: 0 });
        fireEvent.mouseMove(window, { clientY: 380, clientX: 400 }); // onto 14:00

        await waitFor(() => {
            const other = screen.getByText('OtherAppt').closest('[data-testid="week-view-task"]')!;
            expect(other).toHaveStyle({ width: '50%' });
            expect(other).toHaveStyle({ opacity: '1' }); // appointments never fade
        });

        fireEvent.mouseUp(window, { clientY: 380, clientX: 400 });
        await waitFor(() => expect(patched).toHaveLength(1));
    });
});

describe('moving a bucket (regression: no duplicate)', () => {
    it('materializes a moved generated occurrence with its origin_date', async () => {
        const posted: Array<Record<string, unknown>> = [];
        server.use(
            http.get(`${API}/plan/`, () => HttpResponse.json({
                accepted_plan_id: null, warnings: [], appointments: [],
                buckets: [{
                    id: 'gen-1', start_date: '2026-07-08T09:00:00', end_date: '2026-07-08T13:00:00',
                    type_name: 'Daily', type_id: 1, hex_color: '#539dad', persisted: false, items: [],
                }],
            })),
            http.post(`${API}/timebuckets/`, async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                posted.push(body);
                return HttpResponse.json({ id: 'gen-1', ...body }, { status: 201 });
            }),
        );
        render(<PlannedWeekView initialDate={new Date('2026-07-08T08:00:00')} />, { wrapper });

        const block = await screen.findByTestId('bucket-zone');
        // Drag the generated bucket down to a new time.
        fireEvent.mouseDown(block, { clientY: 100, button: 0 });
        fireEvent.mouseMove(window, { clientY: 200 });
        fireEvent.mouseUp(window, { clientY: 200 });

        await waitFor(() => expect(posted).toHaveLength(1));
        // It materializes under the pre-assigned id AND records the original slot
        // so the recurrence rule won't regenerate a duplicate there.
        expect(posted[0].id).toBe('gen-1');
        expect(posted[0].type_id).toBe(1);
        expect(posted[0].origin_date).toBeTruthy();
        expect(posted[0].start_date).toBeTruthy();
    });
});

import { firstFreeDay } from '../../utils/planToWeek.ts';
import type { PlannedBucket } from '../../types.ts';
import { treeDefaults } from '../../testing/treeFixtures.ts';

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
        // firstFreeDay only considers days from "now" onward, so pin the clock
        // to before the free bucket (fake Date only, leaving msw/query timers).
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-08T08:00:00'));
        try {
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
        } finally {
            vi.useRealTimers();
        }
    });
});
