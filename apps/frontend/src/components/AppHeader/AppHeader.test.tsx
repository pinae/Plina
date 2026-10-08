/**
 * UI-5 acceptance (docs/task-entry-ui.md §11, scenarios 1 and 2): the header
 * together with the real Week view against a small stateful fake backend.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppHeader } from './AppHeader.tsx';
import PlannedWeekView from '../PlannedWeekView/PlannedWeekView.tsx';
import { API, loggedInSession, makeTask, makerTag, settingsFor, treeTasks } from '../../testing/treeFixtures.ts';
import { projectFor } from '../../utils/projects.ts';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';
import type { PlanResponse, SettingsWrite, Task, TaskWrite } from '../../types.ts';
import { calendarHandlers, noBucketTypes } from '../../testing/calendarHandlers.ts';

let tasks: Task[] = [];
let tracked: { id: string; since: string } | null = null;
let activeId: string | null = 'hw';
let requests: string[] = [];
let posted: TaskWrite[] = [];

const withTracking = () => tasks.map(t => ({
    ...t, active_tracking_start: tracked?.id === t.id ? tracked.since : null,
}));

// Relative to now so "next planned task" never depends on the clock.
const fromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const plan = (): PlanResponse => ({
    accepted_plan_id: 'plan-1', warnings: [], appointments: [],
    buckets: [{
        id: 'b1', start_date: fromNow(-60), end_date: fromNow(6 * 60), type_name: 'Day', type_id: 1,
        hex_color: '#539dad', persisted: true,
        items: [
            { task_id: 'cad', header: 'CAD', start_time: fromNow(-30), duration: 2 * 3600,
                warnings: [], is_fixed: false, is_appointment: false, hex_color: null },
            { task_id: 'article', header: 'Write CMS comparison', start_time: fromNow(30), duration: 3600,
                warnings: [], is_fixed: false, is_appointment: false, hex_color: null },
        ],
    }],
});

const server = setupServer(
    // Planning light keeps tasks apart from their predecessors.
    http.get(`${API}/dependencies/`, () => HttpResponse.json([])),
    ...calendarHandlers(),
    ...noBucketTypes(),
    http.get(`${API}/plan/`, () => HttpResponse.json(plan())),
    http.get(`${API}/tasks/`, () => HttpResponse.json(withTracking())),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settingsFor(tasks, activeId))),
    http.get(`${API}/auth/session/`, () => HttpResponse.json(loggedInSession())),
    http.patch(`${API}/settings/`, async ({ request }) => {
        const patch = await request.json() as SettingsWrite;
        requests.push(`PATCH settings ${patch.active_task_id}`);
        activeId = patch.active_task_id ?? null;
        return HttpResponse.json(settingsFor(tasks, activeId));
    }),
    http.post(`${API}/tasks/:id/track/start/`, ({ params }) => {
        const id = String(params.id);
        requests.push(`start ${id}`);
        const stopped = tracked && tracked.id !== id ? tracked.id : null;
        tracked = { id, since: new Date().toISOString() };
        const byId = new Map(tasks.map(t => [t.id, t]));
        activeId = projectFor(byId.get(id)!, byId)!.id;
        return HttpResponse.json({
            task: withTracking().find(t => t.id === id), stopped_task_id: stopped,
            settings: settingsFor(tasks, activeId),
        });
    }),
    http.post(`${API}/tasks/:id/track/stop/`, ({ params }) => {
        requests.push(`stop ${params.id}`);
        tracked = null;
        return HttpResponse.json({ task: tasks.find(t => t.id === params.id) });
    }),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = await request.json() as TaskWrite;
        posted.push(body);
        const task = makeTask('new-task', { header: body.header, parent_id: body.parent_id ?? null });
        tasks = [...tasks, task];
        return HttpResponse.json(task, { status: 201 });
    }),
    http.get(`${API}/tasks/:id/`, ({ params }) => HttpResponse.json(tasks.find(t => t.id === params.id))),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
    tasks = treeTasks();
    tracked = null;
    activeId = 'hw';
    requests = [];
    posted = [];
    localStorage.clear(); // recent projects/tags
});
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

function renderApp() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <AppHeader />
            <PlannedWeekView />
        </QueryClientProvider>,
    );
}

const breadcrumb = () => screen.getByRole('navigation', { name: /active project/i });
const header = () => screen.getByRole('banner');
const weekCard = async (title: string) => {
    const cards = await screen.findAllByTestId('week-view-task');
    return cards.find(card => card.textContent?.includes(title))!;
};

describe('Scenario 1 — capture from the Week view', () => {
    it('N, type, Enter: the task lands in the active project and the input stays ready', async () => {
        renderApp();
        await waitFor(() => expect(breadcrumb()).toHaveTextContent('Hardware Design'));
        await weekCard('CAD');

        fireEvent.keyDown(document.body, { key: 'n' });
        const input = screen.getByRole('textbox', { name: /add task/i });
        expect(input).toHaveFocus();

        fireEvent.change(input, { target: { value: 'Order filament 30m #maker' } });
        await waitFor(() => expect(screen.getByTestId('quick-add-project')).toHaveTextContent('T250 › Hardware Design'));
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({
            header: 'Order filament', duration: '00:30:00', tag_ids: ['tag-maker'], parent_id: 'hw',
        });
        await waitFor(() => expect(input).toHaveValue(''));
        expect(input).toHaveFocus();
    });

    it('typing n inside the quick-add input is just a letter', async () => {
        renderApp();
        const input = screen.getByRole('textbox', { name: /add task/i });
        // A direct DOM focus runs React focus handlers: wrap it in act().
        act(() => input.focus());
        fireEvent.keyDown(input, { key: 'p' });
        expect(screen.queryByRole('combobox')).toBeNull(); // the P picker did not open
    });
});

describe('Scenario 2 — engage from the Week view', () => {
    it('▶ on a card tracks it and activates its project; ▶ on another switches over', async () => {
        renderApp();
        await waitFor(() => expect(breadcrumb()).toHaveTextContent('Hardware Design'));

        fireEvent.click(within(await weekCard('CAD')).getByLabelText('start tracking'));
        await waitFor(() => expect(within(header()).getByRole('button', { name: 'CAD' })).toBeInTheDocument());
        expect(within(header()).getByTestId('tracker-elapsed').textContent).toMatch(/^00:00:0\d$/);
        expect(breadcrumb()).toHaveTextContent('T250›Hardware Design');

        fireEvent.click(within(await weekCard('Write CMS comparison')).getByLabelText('start tracking'));
        await waitFor(() => expect(within(header()).getByRole('button', { name: 'Write CMS comparison' }))
            .toBeInTheDocument());
        await waitFor(() => expect(breadcrumb()).toHaveTextContent('Company Blog'));
        expect(requests).toEqual(['start cad', 'start article']); // no separate stop: the server switched
    });

    it('choosing another project by hand keeps the tracked task running', async () => {
        tracked = { id: 'article', since: new Date().toISOString() };
        activeId = 'blog';
        renderApp();
        await waitFor(() => expect(within(header()).getByRole('button', { name: 'Write CMS comparison' }))
            .toBeInTheDocument());

        fireEvent.keyDown(document.body, { key: 'p' });
        const picker = await screen.findByRole('combobox');
        fireEvent.change(picker, { target: { value: 'T250' } });
        fireEvent.keyDown(picker, { key: 'Enter' });

        await waitFor(() => expect(breadcrumb()).toHaveTextContent('T250'));
        expect(within(header()).getByRole('button', { name: 'Write CMS comparison' })).toBeInTheDocument();
        expect(within(header()).getByText('Company Blog')).toBeInTheDocument(); // project prefix
        expect(requests).toEqual(['PATCH settings t250']);
    });

    it('T stops the running task, and starts the next planned one when idle', async () => {
        tracked = { id: 'cad', since: new Date().toISOString() };
        renderApp();
        await waitFor(() => expect(within(header()).getByRole('button', { name: 'CAD' })).toBeInTheDocument());

        fireEvent.keyDown(document.body, { key: 't' });
        await waitFor(() => expect(requests).toEqual(['stop cad']));

        await waitFor(() => expect(within(header()).getByRole('button', { name: /start next/i })).toBeInTheDocument());
        fireEvent.keyDown(document.body, { key: 't' });
        await waitFor(() => expect(requests).toEqual(['stop cad', 'start cad']));
    });
});

describe('Settings (UI-8)', () => {
    it('⚙ opens the settings page', async () => {
        renderApp();
        fireEvent.click(screen.getByRole('button', { name: /settings/i }));
        expect(await screen.findByRole('textbox', { name: /default duration/i })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        await waitFor(() => expect(screen.queryByRole('textbox', { name: /default duration/i })).toBeNull());
    });
});

describe('On a phone (UI-9)', () => {
    let restore: () => void;
    beforeEach(() => { restore = fakeScreen(PHONE); localStorage.clear(); });
    afterEach(() => restore());

    it('the header is compact: last project level, ▶, icons — the quick add moves to ⊕', async () => {
        renderApp();
        expect(await within(header()).findByRole('button', { name: 'active project: Hardware Design' })).toBeInTheDocument();
        expect(within(header()).queryByRole('textbox', { name: /add task/i })).toBeNull();
        expect(within(header()).getByRole('button', { name: 'settings' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'add task' })).toBeInTheDocument();
    });

    it('capture by tapping: ⊕, type the name, tap estimate and tag, Add (UI-9 acceptance)', async () => {
        renderApp();
        await weekCard('CAD');
        fireEvent.click(screen.getByRole('button', { name: 'add task' }));
        const sheet = await screen.findByRole('dialog', { name: 'Add task' });
        fireEvent.change(within(sheet).getByRole('textbox', { name: /add task/i }), { target: { value: 'Order filament' } });
        fireEvent.click(await within(sheet).findByRole('button', { name: '30m' }));
        fireEvent.click(within(sheet).getByRole('button', { name: '#maker' }));
        fireEvent.click(within(sheet).getByRole('button', { name: /^add$/i }));

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({
            header: 'Order filament', duration: '00:30:00', tag_ids: ['tag-maker'], parent_id: 'hw',
        });
    });

    it('▶ on a card: the compact tracker shows ⏹ time ✓ (spec §3 mobile)', async () => {
        renderApp();
        fireEvent.click(within(await weekCard('CAD')).getByRole('button', { name: /start tracking/i }));
        const time = await within(header()).findByRole('button', { name: 'tracking CAD' });
        expect(time).toHaveTextContent(/^\d\d:\d\d:\d\d$/);
        expect(within(header()).getByRole('button', { name: /stop tracking/i })).toBeInTheDocument();
        expect(within(header()).getByRole('button', { name: /complete tracked task/i })).toBeInTheDocument();
    });

    it('N still opens the quick add (external keyboards)', async () => {
        renderApp();
        await weekCard('CAD');
        fireEvent.keyDown(document.body, { key: 'n' });
        expect(await screen.findByRole('dialog', { name: 'Add task' })).toBeInTheDocument();
    });
});

