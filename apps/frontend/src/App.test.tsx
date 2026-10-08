/**
 * T-2 (docs/tasks-tab.md): the Tasks tab — the task tree — comes first and is
 * where the app opens; Week follows. The old flat task list is gone, but
 * adding and editing tasks still works from the Tasks tab.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import App from './App.tsx';
import { API, makeTask, makerTag, settingsFor, treeTasks } from './testing/treeFixtures.ts';
import type { Task, TaskWrite } from './types.ts';
import { calendarHandlers, noBucketTypes } from './testing/calendarHandlers.ts';
import { savedFilterHandlers } from './testing/savedFilterHandlers.ts';

let tasks: Task[] = [];
let posted: TaskWrite[] = [];
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const settings = () => ({ ...settingsFor(tasks, 'hw'), time_zone: zone });

const server = setupServer(
    ...calendarHandlers(),
    ...savedFilterHandlers(),
    ...noBucketTypes(),
    http.get(`${API}/tasks/`, () => HttpResponse.json(tasks)),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settings())),
    http.get(`${API}/plan/`, () => HttpResponse.json({ accepted_plan_id: null, warnings: [], appointments: [], buckets: [] })),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = await request.json() as TaskWrite;
        posted.push(body);
        const task = makeTask('new-task', { header: body.header, parent_id: body.parent_id ?? null });
        tasks = [...tasks, task];
        return HttpResponse.json(task, { status: 201 });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => { tasks = treeTasks(); posted = []; localStorage.clear(); });
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

function renderApp() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

const tabs = () => within(screen.getByRole('tablist', { name: /plina tabs/i })).getAllByRole('tab');

describe('Tabs (T-2)', () => {
    it('Tasks first, Week second — and the app opens on Tasks', async () => {
        renderApp();
        expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(
            ['Tasks', 'Week Overview', 'Calendar Plan', 'Time Sheet', 'Tags', 'Time Buckets', 'Dependencies']);
        expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
        expect(await screen.findByRole('tree', { name: /outline/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    });

    it('the Time Sheet tab shows this month’s time sheet (README: Time sheet)', async () => {
        server.use(http.get(`${API}/timesheet/`, ({ request }) => {
            const params = new URL(request.url).searchParams;
            return HttpResponse.json({ from: params.get('from'), to: params.get('to'), work_tags: ['Arbeit', 'Work'],
                pause_tags: ['Freizeit', 'Freetime'], days: [] });
        }));
        renderApp();
        fireEvent.click(screen.getByRole('tab', { name: 'Time Sheet' }));
        expect(await screen.findByRole('table', { name: 'time sheet' })).toBeInTheDocument();
        const month = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        expect(await screen.findByText(`No work tracked in ${month}.`, { exact: false })).toBeInTheDocument();
    });

    it('there is no separate Projects tab any more', () => {
        renderApp();
        expect(screen.queryByRole('tab', { name: /projects/i })).toBeNull();
    });

    it('"+ New task" in the Tasks tab adds a task to the active project', async () => {
        renderApp();
        fireEvent.click(await screen.findByRole('button', { name: /new task/i }));
        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /parent/i })).toHaveValue('T250 › Hardware Design'));
        fireEvent.change(within(dialog).getByRole('textbox', { name: /^header$/i }), { target: { value: 'Order filament' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /create/i }));
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ header: 'Order filament', parent_id: 'hw' });
    });

    it('a click on a task opens the edit dialog', async () => {
        renderApp();
        fireEvent.click(await screen.findByRole('treeitem', { name: 'CAD' }));
        expect(await screen.findByRole('dialog')).toHaveTextContent('Edit “CAD”');
    });

    it('"Show all tasks" in the project picker opens the Tasks tab', async () => {
        renderApp();
        fireEvent.click(screen.getByRole('tab', { name: 'Week Overview' }));
        await waitFor(() => expect(screen.queryByRole('tree', { name: /outline/i })).toBeNull());
        fireEvent.click(await screen.findByRole('button', { name: /change active project/i }));
        fireEvent.click(await screen.findByRole('button', { name: /show all tasks/i }));
        expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
        expect(await screen.findByRole('tree', { name: /outline/i })).toBeInTheDocument();
    });
});
