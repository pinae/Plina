/**
 * WP-10 tests: the plan chooser.
 *
 * - formatSlack colors/labels; miniTimeline groups the first 3 days
 * - 3-alternative payload renders 3 cards; infeasible card shows warning text
 * - accepting fires exactly one request (double-click guarded)
 * - a single alternative auto-accepts silently (no fake choice)
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import {
    commonWarnings, formatSlack, miniTimeline, nextTasks, planByDay, projectOf, slackSeverity,
} from '../../utils/planChooser.ts';
import { makeTask } from '../../testing/treeFixtures.ts';
import { PlanChooser } from './PlanChooser.tsx';
import { PlanChooserDialog } from '../PlanChooserDialog/PlanChooserDialog.tsx';
import type { PlanAlternative, PlanWarning } from '../../types.ts';

// Local times: the mini timeline groups by local day, so UTC fixtures would
// split a day in far-off timezones.
const at = (day: number, hour: number) => new Date(2026, 6, day, hour).toISOString();

function alternative(
    id: string, label: string,
    overrides: Partial<PlanAlternative> = {},
): PlanAlternative {
    return {
        id, label, feasible: true, warnings: [],
        metrics: {
            min_slack_seconds: 2 * 24 * 3600,
            context_switches: 3,
            priority_earliness_hours: 5,
            project_finishes: [
                { project_id: 'p1', name: 'Webshop', finish: '2026-07-09T11:00:00Z' },
            ],
        },
        appointments: [],
        buckets: [
            {
                id: 'b1',
                start_date: at(8, 9), end_date: at(8, 13),
                type_name: 'Daily', type_id: 1, hex_color: '#539dad', persisted: true,
                items: [
                    {
                        task_id: 't1', header: 'Design Schema',
                        start_time: at(8, 9), duration: 7200,
                        warnings: [], is_fixed: false, is_appointment: false,
                        hex_color: '#3357ff',
                    },
                    {
                        task_id: 't2', header: 'Implement API',
                        start_time: at(8, 11), duration: 7200,
                        warnings: [], is_fixed: false, is_appointment: false,
                        hex_color: null,
                    },
                ],
            },
            {
                id: 'b2',
                start_date: at(9, 9), end_date: at(9, 13),
                type_name: 'Daily', type_id: 1, hex_color: '#539dad', persisted: true,
                items: [
                    {
                        task_id: 't3', header: 'Load Test',
                        start_time: at(9, 9), duration: 3600,
                        warnings: [], is_fixed: false, is_appointment: false,
                        hex_color: null,
                    },
                ],
            },
        ],
        ...overrides,
    };
}

describe('formatSlack / slackSeverity', () => {
    it('formats and colors slack values', () => {
        expect(formatSlack(2 * 24 * 3600 + 6 * 3600)).toBe('2d 6h slack');
        expect(formatSlack(-5400)).toBe('1h 30m over');
        expect(formatSlack(null)).toBe('no deadline pressure');
        expect(slackSeverity(-1)).toBe('error');
        expect(slackSeverity(3600)).toBe('warning');   // under a day
        expect(slackSeverity(48 * 3600)).toBe('success');
        expect(slackSeverity(null)).toBe('default');
    });
});

describe('miniTimeline', () => {
    it('groups items of the first days with duration weights', () => {
        const days = miniTimeline(alternative('a', 'A'), 3);

        expect(days).toHaveLength(2); // only two distinct days in the fixture
        expect(days[0].blocks.map(block => block.header)).toEqual(
            ['Design Schema', 'Implement API'],
        );
        expect(days[0].blocks[0].weight).toBe(7200);
        expect(days[1].blocks.map(block => block.header)).toEqual(['Load Test']);
    });

    it('caps at the requested number of days', () => {
        const alt = alternative('a', 'A');
        const dayBucket = (id: string, day: string) => ({
            ...alt.buckets[1], id,
            start_date: `${day}T09:00:00Z`, end_date: `${day}T13:00:00Z`,
            items: alt.buckets[1].items.map(item => ({
                ...item, start_time: `${day}T09:00:00Z`,
            })),
        });
        alt.buckets = [...alt.buckets, dayBucket('b3', '2026-07-10'), dayBucket('b4', '2026-07-11')];
        expect(miniTimeline(alt, 3)).toHaveLength(3);
    });
});

describe('what the chooser shows (docs/plan-chooser.md)', () => {
    const meeting = {
        task_id: 'meet', header: 'Team Sync', start_time: at(8, 10), duration: 3600,
        warnings: [], is_fixed: true, is_appointment: true, hex_color: '#8833ff',
    };
    const withMeeting = () => alternative('a', 'A', { appointments: [meeting] });

    it('lists the next tasks — appointments aside, the running one marked', () => {
        const next = nextTasks(withMeeting(), { runningTaskId: 't1' });
        expect(next.map(task => [task.header, task.running])).toEqual([
            ['Design Schema', true], ['Implement API', false], ['Load Test', false],
        ]);
        expect(next[0].start).toEqual(new Date(at(8, 9)));
        expect(nextTasks(withMeeting(), { count: 2 })).toHaveLength(2);
    });

    it('groups the whole plan by day, appointments included', () => {
        const days = planByDay(withMeeting());
        expect(days).toHaveLength(2);
        expect(days[0].items.map(item => [item.header, item.isAppointment])).toEqual([
            ['Design Schema', false], ['Team Sync', true], ['Implement API', false],
        ]);
        expect(days[1].items.map(item => item.header)).toEqual(['Load Test']);
    });

    it('draws appointments grey in the timeline: they are the same in every plan', () => {
        const blocks = miniTimeline(withMeeting(), 3)[0].blocks;
        const sync = blocks.find(block => block.header === 'Team Sync')!;
        expect(sync.appointment).toBe(true);
        expect(sync.color).toBe('#9e9e9e');
    });

    it('leaves out what is over: the choice is about what comes', () => {
        const from = new Date(at(8, 12)); // after Design Schema, before Implement API ends
        expect(planByDay(withMeeting(), from)[0].items.map(item => item.header)).toEqual(['Implement API']);
        expect(miniTimeline(withMeeting(), 3, from)[0].blocks.map(block => block.header)).toEqual(['Implement API']);
    });

    it('finds the warnings every plan has', () => {
        const late: PlanWarning = { task_id: 'p', header: 'Paper', kind: 'deadline_missed', deadline: null, projected_finish: null };
        const own: PlanWarning = { task_id: 't3', header: 'Load Test', kind: 'deadline_missed', deadline: null, projected_finish: null };
        const plans = [alternative('a', 'A', { warnings: [late] }), alternative('b', 'B', { warnings: [late, own] })];
        expect(commonWarnings(plans)).toEqual([late]);
        expect(commonWarnings([plans[1]])).toEqual([]); // one plan: nothing to compare
    });

    it('names the project of a task', () => {
        const tasks = [
            makeTask('t250', { header: 'T250', children_ids: ['cad'] }),
            makeTask('cad', { header: 'CAD', parent_id: 't250', ancestor_ids: ['t250'] }),
            makeTask('milk', { header: 'Buy milk' }),
        ];
        expect(projectOf('cad', tasks)).toBe('T250');
        expect(projectOf('t250', tasks)).toBe('T250'); // a project's Rest
        expect(projectOf('milk', tasks)).toBeNull(); // a single step
        expect(projectOf('gone', tasks)).toBeNull();
    });
});

const wrapperClient = () => new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={wrapperClient()}>{children}</QueryClientProvider>
    );
}

describe('PlanChooser', () => {
    // The morning the fixture plans start: nothing of them is over yet.
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at(8, 8))); });
    afterEach(() => vi.useRealTimers());

    const three = [
        alternative('plan-a', 'Deadline-safe'),
        alternative('plan-b', 'Flow — fewer context switches'),
        alternative('plan-c', 'Start with “Setup React”', {
            feasible: false,
            warnings: [{
                task_id: 't3', header: 'Load Test', kind: 'deadline_missed',
                deadline: '2026-07-09T00:00:00Z', projected_finish: '2026-07-09T12:00:00Z',
            }],
            metrics: {
                min_slack_seconds: -3600, context_switches: 5,
                priority_earliness_hours: 7, project_finishes: [],
            },
        }),
    ];

    it('renders one card per alternative', () => {
        render(<PlanChooser alternatives={three} onAccept={() => { }} accepting={false} />);
        expect(screen.getAllByTestId('plan-alternative-card')).toHaveLength(3);
        expect(screen.getByText('Deadline-safe')).toBeInTheDocument();
    });

    it('shows the warning text on infeasible cards', () => {
        render(<PlanChooser alternatives={three} onAccept={() => { }} accepting={false} />);
        expect(screen.getByText(/“Load Test” misses its deadline/i)).toBeInTheDocument();
        expect(screen.getByText('1h over')).toBeInTheDocument();
    });

    it('reports the chosen plan id exactly once even on double click', () => {
        const onAccept = vi.fn();
        const { rerender } = render(
            <PlanChooser alternatives={three} onAccept={onAccept} accepting={false} />,
        );

        const button = screen.getAllByRole('button', { name: /choose this plan/i })[0];
        fireEvent.click(button);
        // The parent flips `accepting` while the request runs; buttons lock.
        rerender(<PlanChooser alternatives={three} onAccept={onAccept} accepting={true} />);
        fireEvent.click(button);

        expect(onAccept).toHaveBeenCalledTimes(1);
        expect(onAccept).toHaveBeenCalledWith('plan-a');
    });

    const tasks = [
        makeTask('web', { header: 'Webshop', children_ids: ['t1', 't2', 't3'] }),
        makeTask('t1', { header: 'Design Schema', parent_id: 'web', ancestor_ids: ['web'] }),
        makeTask('t2', { header: 'Implement API', parent_id: 'web', ancestor_ids: ['web'] }),
        makeTask('t3', { header: 'Load Test', parent_id: 'web', ancestor_ids: ['web'] }),
    ];

    it('shows the next tasks of each option with their project — no hovering', () => {
        render(<PlanChooser alternatives={three} tasks={tasks} onAccept={() => { }} accepting={false} />);
        const card = screen.getAllByTestId('plan-alternative-card')[0];
        const next = within(card).getByRole('list', { name: 'Next' });
        expect(within(next).getAllByRole('listitem').map(row => row.textContent)).toEqual([
            expect.stringContaining('Design Schema'), expect.stringContaining('Implement API'),
            expect.stringContaining('Load Test'),
        ]);
        expect(within(next).getAllByText('Webshop')).toHaveLength(3);
    });

    it('marks the running task as going on now', () => {
        const running = tasks.map(task => (task.id === 't1' ? { ...task, active_tracking_start: at(8, 8) } : task));
        render(<PlanChooser alternatives={three} tasks={running} onAccept={() => { }} accepting={false} />);
        const first = within(screen.getAllByRole('list', { name: 'Next' })[0]).getAllByRole('listitem')[0];
        expect(first).toHaveTextContent('Design Schema');
        expect(first).toHaveTextContent('now');
    });

    it('keeps the rest of the plan in an expandable list', () => {
        render(<PlanChooser alternatives={three} tasks={tasks} onAccept={() => { }} accepting={false} />);
        const card = screen.getAllByTestId('plan-alternative-card')[0];
        expect(within(card).queryByRole('list', { name: 'Whole plan' })).toBeNull();
        fireEvent.click(within(card).getByRole('button', { name: 'Whole plan (3 tasks)' }));
        const whole = within(card).getByRole('list', { name: 'Whole plan' });
        expect(within(whole).getAllByRole('listitem')).toHaveLength(3);
    });

    it('says a warning every plan has once, above the options', () => {
        const late: PlanWarning = {
            task_id: 'p', header: 'Finish the paper', kind: 'deadline_missed', deadline: null, projected_finish: null,
        };
        const plans = three.map(plan => ({ ...plan, feasible: false, warnings: [...plan.warnings, late] }));
        render(<PlanChooser alternatives={plans} tasks={tasks} onAccept={() => { }} accepting={false} />);
        expect(screen.getByTestId('common-warnings')).toHaveTextContent('In every plan: “Finish the paper” misses its deadline');
        for (const card of screen.getAllByTestId('plan-alternative-card')) {
            expect(within(card).queryByText(/Finish the paper/)).toBeNull();
        }
        // What only one plan risks stays on its card.
        expect(within(screen.getAllByTestId('plan-alternative-card')[2]).getByText(/“Load Test” misses its deadline/))
            .toBeInTheDocument();
    });
});

const API = 'http://localhost:8000/api';

describe('PlanChooserDialog', () => {
    let acceptCalls: string[] = [];

    const server = setupServer();
    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => { server.resetHandlers(); acceptCalls = []; });
    afterAll(() => server.close());

    const acceptHandler = http.post(`${API}/plans/:id/accept/`, ({ params }) => {
        acceptCalls.push(params.id as string);
        return HttpResponse.json({ id: params.id, is_accepted: true });
    });

    it('computes on open and accepts the clicked card exactly once', async () => {
        server.use(
            http.post(`${API}/plan/alternatives/`, () =>
                HttpResponse.json({
                    alternatives: [
                        alternative('plan-a', 'Deadline-safe'),
                        alternative('plan-b', 'Flow'),
                    ],
                }),
            ),
            acceptHandler,
            http.get(`${API}/tasks/`, () => HttpResponse.json([])),
            http.get(`${API}/plan/`, () =>
                HttpResponse.json({ accepted_plan_id: 'plan-a', warnings: [], appointments: [], buckets: [] }),
            ),
        );
        const onAccepted = vi.fn();
        render(
            <PlanChooserDialog open onClose={() => { }} onAccepted={onAccepted} />,
            { wrapper },
        );

        const buttons = await screen.findAllByRole('button', { name: /choose this plan/i });
        fireEvent.click(buttons[1]);
        fireEvent.click(buttons[1]);

        await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
        expect(acceptCalls).toEqual(['plan-b']);
    });

    it('auto-accepts a single alternative silently', async () => {
        server.use(
            http.post(`${API}/plan/alternatives/`, () =>
                HttpResponse.json({ alternatives: [alternative('plan-only', 'Deadline-safe')] }),
            ),
            acceptHandler,
            http.get(`${API}/tasks/`, () => HttpResponse.json([])),
            http.get(`${API}/plan/`, () =>
                HttpResponse.json({ accepted_plan_id: 'plan-only', warnings: [], appointments: [], buckets: [] }),
            ),
        );
        const onAccepted = vi.fn();
        render(
            <PlanChooserDialog open onClose={() => { }} onAccepted={onAccepted} />,
            { wrapper },
        );

        await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
        expect(acceptCalls).toEqual(['plan-only']);
        expect(screen.queryAllByTestId('plan-alternative-card')).toHaveLength(0);
    });
});

describe('PlanChooserDialog with nothing schedulable (no-buckets trap)', () => {
    const server2 = setupServer(
        http.post(`${API}/plan/alternatives/`, () =>
            HttpResponse.json({
                alternatives: [
                    alternative('plan-empty', 'Deadline-safe', {
                        feasible: false,
                        buckets: [],
                        warnings: [{
                            task_id: 't1', header: 'Design Schema',
                            kind: 'unplanned_within_horizon',
                            deadline: null, projected_finish: null,
                        }],
                        metrics: {
                            min_slack_seconds: null, context_switches: 0,
                            priority_earliness_hours: null, project_finishes: [],
                        },
                    }),
                ],
            }),
        ),
        http.post(`${API}/plans/:id/accept/`, () => {
            throw new Error('an empty plan must never be auto-accepted');
        }),
        http.get(`${API}/tasks/`, () => HttpResponse.json([])),
    );
    beforeAll(() => server2.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server2.resetHandlers());
    afterAll(() => server2.close());

    it('explains the situation instead of silently accepting an empty plan', async () => {
        const onAccepted = vi.fn();
        render(
            <PlanChooserDialog open onClose={() => { }} onAccepted={onAccepted} />,
            { wrapper },
        );

        await waitFor(() =>
            expect(screen.getByText(/could not be scheduled/i)).toBeInTheDocument(),
        );
        expect(screen.getByText(/time bucket/i)).toBeInTheDocument();
        expect(screen.getByText(/Design Schema/)).toBeInTheDocument();
        expect(onAccepted).not.toHaveBeenCalled();
        expect(screen.queryAllByTestId('plan-alternative-card')).toHaveLength(0);
    });
});
