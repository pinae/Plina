/**
 * WP-10 tests: the plan chooser.
 *
 * - formatSlack colors/labels; miniTimeline groups the first 3 days
 * - 3-alternative payload renders 3 cards; infeasible card shows warning text
 * - accepting fires exactly one request (double-click guarded)
 * - a single alternative auto-accepts silently (no fake choice)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { formatSlack, miniTimeline, slackSeverity } from './utils/planChooser';
import { PlanChooser } from './components/PlanChooser';
import { PlanChooserDialog } from './components/PlanChooserDialog';
import type { PlanAlternative } from './types';

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
                start_date: '2026-07-08T09:00:00Z', end_date: '2026-07-08T13:00:00Z',
                type_name: 'Daily', hex_color: '#539dad',
                items: [
                    {
                        task_id: 't1', header: 'Design Schema',
                        start_time: '2026-07-08T09:00:00Z', duration: 7200,
                        warnings: [], is_fixed: false, is_appointment: false,
                        hex_color: '#3357ff',
                    },
                    {
                        task_id: 't2', header: 'Implement API',
                        start_time: '2026-07-08T11:00:00Z', duration: 7200,
                        warnings: [], is_fixed: false, is_appointment: false,
                        hex_color: null,
                    },
                ],
            },
            {
                id: 'b2',
                start_date: '2026-07-09T09:00:00Z', end_date: '2026-07-09T13:00:00Z',
                type_name: 'Daily', hex_color: '#539dad',
                items: [
                    {
                        task_id: 't3', header: 'Load Test',
                        start_time: '2026-07-09T09:00:00Z', duration: 3600,
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

const wrapperClient = () => new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={wrapperClient()}>{children}</QueryClientProvider>
    );
}

describe('PlanChooser', () => {
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
        expect(screen.getByText(/Load Test/)).toBeInTheDocument();
        expect(screen.getByText(/misses its deadline/i)).toBeInTheDocument();
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
            http.get(`${API}/plan/`, () =>
                HttpResponse.json({ accepted_plan_id: 'plan-a', appointments: [], buckets: [] }),
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
            http.get(`${API}/plan/`, () =>
                HttpResponse.json({ accepted_plan_id: 'plan-only', appointments: [], buckets: [] }),
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
