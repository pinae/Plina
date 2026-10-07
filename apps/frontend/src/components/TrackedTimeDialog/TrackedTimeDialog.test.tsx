/**
 * Tracked time (README: Time sheet): correcting a session — e.g. one left
 * running over night — deleting one, and entering time not tracked live.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { TrackedTimeDialog } from './TrackedTimeDialog.tsx';
import { API, makeTask } from '../../testing/treeFixtures.ts';
import type { TrackedSession } from '../../types.ts';
import { composeSpan, keepSeconds, untilNextDay } from '../../utils/trackedTime.ts';

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const report = makeTask('report', { header: 'Report' });
const lunch = makeTask('lunch', { header: 'Lunch' });

const session = (id: string, start: string, end: string | null, over: Partial<TrackedSession> = {}): TrackedSession => ({
    id, task_id: 'report', task_header: 'Report', task_tags: [], start, end, running: end === null,
    seconds: end ? (new Date(end).getTime() - new Date(start).getTime()) / 1000 : 600, ...over,
});

let sessions: TrackedSession[] = [];
let log: { method: string; path: string; query: string; body: unknown }[] = [];
let refuse: string | null = null;

const record = async (request: Request) => {
    const url = new URL(request.url);
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    log.push({ method: request.method, path: url.pathname.replace(/^\/api\//, ''), query: url.search,
        body: text ? JSON.parse(text) : null });
};

const server = setupServer(
    http.get(`${API}/sessions/`, async ({ request }) => {
        await record(request);
        return HttpResponse.json(sessions);
    }),
    http.post(`${API}/sessions/`, async ({ request }) => {
        await record(request);
        if (refuse) return HttpResponse.json({ detail: refuse }, { status: 400 });
        return HttpResponse.json(session('new', local(6, 8), local(6, 9)), { status: 201 });
    }),
    http.patch(`${API}/sessions/:id/`, async ({ request }) => {
        await record(request);
        if (refuse) return HttpResponse.json({ end: [refuse] }, { status: 400 });
        return HttpResponse.json(sessions[0]);
    }),
    http.delete(`${API}/sessions/:id/`, async ({ request }) => {
        await record(request);
        return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${API}/tasks/`, () => HttpResponse.json([report, lunch])),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    sessions = [];
    log = [];
    refuse = null;
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const field = (scope: HTMLElement, label: string) => within(scope).getByLabelText(label) as HTMLInputElement;
const changes = () => log.filter(entry => entry.method !== 'GET');

describe('composeSpan', () => {
    it('reads an until at or before the from as the next day', () => {
        expect(composeSpan('2026-10-06', '08:00', '12:30')).toEqual({
            start: new Date(2026, 9, 6, 8), end: new Date(2026, 9, 6, 12, 30),
        });
        expect(composeSpan('2026-10-06', '22:00', '01:30').end).toEqual(new Date(2026, 9, 7, 1, 30));
        expect(composeSpan('2026-10-06', '22:00', '').end).toBeNull();
        expect(untilNextDay('22:00', '01:30')).toBe(true);
        expect(untilNextDay('08:00', '12:00')).toBe(false);
    });
});

describe('keepSeconds', () => {
    it('keeps the seconds of a time whose minute did not change', () => {
        const tracked = new Date(2026, 9, 6, 10, 15, 37).toISOString();
        expect(keepSeconds(new Date(2026, 9, 6, 10, 15), tracked)).toBe(tracked);
        expect(keepSeconds(new Date(2026, 9, 6, 10, 16), tracked)).toBe(local(6, 10, 16));
        expect(keepSeconds(new Date(2026, 9, 6, 10, 15), null)).toBe(local(6, 10, 15));
    });
});

describe('TrackedTimeDialog by task', () => {
    it('keeps the seconds tracked live where only the other end was changed', async () => {
        // Switched to it live at 10:15:37: the editor shows 10:15.
        const start = new Date(2026, 9, 6, 10, 15, 37).toISOString();
        sessions = [session('b', start, new Date(2026, 9, 6, 11, 0, 5).toISOString())];
        render(<TrackedTimeDialog task={report} onClose={() => {}} />, { wrapper });
        const [row] = await screen.findAllByTestId('tracked-session');
        expect(field(row, 'From').value).toBe('10:15');

        fireEvent.change(field(row, 'Until'), { target: { value: '11:30' } });
        fireEvent.click(within(row).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(changes()).toHaveLength(1));
        expect(changes()[0].body).toEqual({ start, end: local(6, 11, 30) });
    });

    it('lists the task’s time, the latest first, and cuts back a night that ran on', async () => {
        sessions = [session('a', local(5, 9), local(5, 12)), session('b', local(6, 17), local(7, 9))];
        render(<TrackedTimeDialog task={report} onClose={() => {}} />, { wrapper });

        const rows = await screen.findAllByTestId('tracked-session');
        expect(log[0].query).toBe('?task=report');
        expect(field(rows[0], 'Day').value).toBe('2026-10-06');
        expect(field(rows[0], 'Until').value).toBe('09:00');
        expect(within(rows[0]).getByText('the next day')).toBeInTheDocument();
        expect(within(rows[0]).getByTestId('session-duration')).toHaveTextContent('16h');
        expect(screen.getByTestId('tracked-total')).toHaveTextContent('Together: 19h');

        fireEvent.change(field(rows[0], 'Until'), { target: { value: '18:30' } });
        expect(within(rows[0]).getByTestId('session-duration')).toHaveTextContent('1h 30m');
        fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(changes()).toHaveLength(1));
        expect(changes()[0]).toEqual({ method: 'PATCH', path: 'sessions/b/', query: '',
            body: { start: local(6, 17), end: local(6, 18, 30) } });
    });

    it('stops the time being tracked by giving it an end', async () => {
        sessions = [session('r', local(6, 17), null)];
        render(<TrackedTimeDialog task={report} onClose={() => {}} />, { wrapper });
        const [row] = await screen.findAllByTestId('tracked-session');
        expect(row).toHaveAttribute('data-running', 'true');
        expect(within(row).getAllByText('running').length).toBeGreaterThan(0);
        // Correcting only the start keeps it running.
        fireEvent.change(field(row, 'From'), { target: { value: '16:30' } });
        fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(changes()).toHaveLength(1));
        expect(changes()[0].body).toEqual({ start: local(6, 16, 30), end: null });

        fireEvent.change(field(row, 'Until'), { target: { value: '18:00' } });
        fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(changes()).toHaveLength(2));
        expect(changes()[1].body).toEqual({ start: local(6, 16, 30), end: local(6, 18) });
    });

    it('shows why the server refused, and Undo goes back', async () => {
        refuse = 'The end is not after the start.';
        sessions = [session('a', local(5, 9), local(5, 12))];
        render(<TrackedTimeDialog task={report} onClose={() => {}} />, { wrapper });
        const [row] = await screen.findAllByTestId('tracked-session');
        fireEvent.change(field(row, 'From'), { target: { value: '10:00' } });
        fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
        expect(await within(row).findByText('The end is not after the start.')).toBeInTheDocument();

        fireEvent.click(within(row).getByRole('button', { name: 'Undo' }));
        expect(field(row, 'From').value).toBe('09:00');
        expect(within(row).queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('deletes a time after asking', async () => {
        sessions = [session('a', local(5, 9), local(5, 12))];
        render(<TrackedTimeDialog task={report} onClose={() => {}} />, { wrapper });
        const [row] = await screen.findAllByTestId('tracked-session');
        fireEvent.click(within(row).getByRole('button', { name: 'delete this time' }));
        expect(within(row).getByText('Delete 3h on “Report”?')).toBeInTheDocument();
        fireEvent.click(within(row).getByRole('button', { name: 'Keep' }));
        expect(changes()).toHaveLength(0);

        fireEvent.click(within(row).getByRole('button', { name: 'delete this time' }));
        fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(changes()).toEqual([{ method: 'DELETE', path: 'sessions/a/', query: '', body: null }]));
    });

    it('adds time that was not tracked live', async () => {
        render(<TrackedTimeDialog task={report} onClose={() => {}} />, { wrapper });
        expect(await screen.findByText('No time tracked on this task yet.')).toBeInTheDocument();
        const form = screen.getByRole('form', { name: 'add time' });

        fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
        expect(within(form).getByText(/Enter when it began/)).toBeInTheDocument();

        fireEvent.change(field(form, 'Day'), { target: { value: '2026-10-05' } });
        fireEvent.change(field(form, 'From'), { target: { value: '22:00' } });
        fireEvent.change(field(form, 'Until'), { target: { value: '01:30' } });
        expect(within(form).getByText('the next day')).toBeInTheDocument();
        expect(within(form).getByText('3h 30m')).toBeInTheDocument();
        fireEvent.click(within(form).getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(changes()).toHaveLength(1));
        expect(changes()[0].body).toEqual({ task_id: 'report', start: local(5, 22), end: local(6, 1, 30) });
        await waitFor(() => expect(field(form, 'From').value).toBe(''));
    });
});

describe('TrackedTimeDialog by day', () => {
    it('shows everything begun that day and adds time to a chosen task', async () => {
        sessions = [
            session('a', local(6, 8), local(6, 12)),
            session('b', local(6, 12), local(6, 12, 45), { task_id: 'lunch', task_header: 'Lunch' }),
        ];
        render(<TrackedTimeDialog day="2026-10-06" onClose={() => {}} />, { wrapper });

        const rows = await screen.findAllByTestId('tracked-session');
        expect(log[0].query).toBe('?from=2026-10-06&to=2026-10-06');
        expect(rows.map(row => within(row).getByRole('heading', { level: 6, hidden: true }).textContent))
            .toEqual(['Report', 'Lunch']);

        const form = screen.getByRole('form', { name: 'add time' });
        expect(within(form).queryByLabelText('Day')).toBeNull(); // the day above
        fireEvent.change(field(form, 'From'), { target: { value: '13:00' } });
        fireEvent.change(field(form, 'Until'), { target: { value: '17:00' } });
        fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
        expect(within(form).getByText(/On which task/)).toBeInTheDocument();

        fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Task' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Report' }));
        fireEvent.click(within(form).getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(changes()).toHaveLength(1));
        expect(changes()[0].body).toEqual({ task_id: 'report', start: local(6, 13), end: local(6, 17) });
    });

    it('shows the overlap the server refuses', async () => {
        refuse = 'This overlaps “Lunch” (Tue 06/10 12:00 – Tue 06/10 12:45): one task at a time.';
        render(<TrackedTimeDialog task={report} onClose={() => {}} />, { wrapper });
        const form = await screen.findByRole('form', { name: 'add time' });
        fireEvent.change(field(form, 'Day'), { target: { value: '2026-10-06' } });
        fireEvent.change(field(form, 'From'), { target: { value: '11:00' } });
        fireEvent.change(field(form, 'Until'), { target: { value: '13:00' } });
        fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
        expect(await within(form).findByText(/overlaps “Lunch”/)).toBeInTheDocument();
    });

    it('goes to another day', async () => {
        render(<TrackedTimeDialog day="2026-10-06" onClose={() => {}} />, { wrapper });
        expect(await screen.findByText(/Nothing tracked on/)).toBeInTheDocument();
        fireEvent.change(screen.getAllByLabelText('Day')[0], { target: { value: '2026-10-05' } });
        await waitFor(() => expect(log.map(entry => entry.query)).toContain('?from=2026-10-05&to=2026-10-05'));
    });
});
