/**
 * The time sheet (README: Time sheet): a row per day with begin, end, pause
 * and working time; the arrow opens the tasks counted that day.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import TimeSheet from './TimeSheet.tsx';
import { API } from '../../testing/treeFixtures.ts';
import type { TimeSheet as Sheet, TimeSheetDay } from '../../types.ts';
import { hoursAndMinutes } from '../../utils/duration.ts';

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const arbeit = { id: 'tag-arbeit', name: 'Arbeit', hex_color: '#3f51b5' };
const freizeit = { id: 'tag-freizeit', name: 'Freizeit', hex_color: '#4caf50' };

const wednesday: TimeSheetDay = {
    date: '2026-10-07', begin: local(7, 8, 15), end: local(7, 17), running: false,
    pause_seconds: 55 * 60, working_seconds: (8 * 60 + 45 - 55) * 60,
    entries: [
        { task_id: 'report', header: 'Report', tags: [arbeit], kind: 'work', seconds: 315 * 60, running: false },
        { task_id: 'lunch', header: 'Lunch', tags: [freizeit], kind: 'pause', seconds: 55 * 60, running: false },
    ],
};
const thursday: TimeSheetDay = {
    date: '2026-10-08', begin: local(8, 9), end: local(8, 11, 30), running: true,
    pause_seconds: 0, working_seconds: 150 * 60,
    entries: [{ task_id: 'report', header: 'Report', tags: [arbeit], kind: 'work', seconds: 150 * 60, running: true }],
};

let requests: string[] = [];
let days: TimeSheetDay[] = [];
let sessionQueries: string[] = [];

const server = setupServer(
    http.get(`${API}/timesheet/`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(`${params.get('from')}..${params.get('to')}`);
        const sheet: Sheet = {
            from: params.get('from')!, to: params.get('to')!, work_tags: ['Arbeit', 'Work'],
            pause_tags: ['Freizeit', 'Freetime'], days: params.get('from') === '2026-10-01' ? days : [],
        };
        return HttpResponse.json(sheet);
    }),
    http.get(`${API}/sessions/`, ({ request }) => {
        sessionQueries.push(new URL(request.url).search);
        return HttpResponse.json([]);
    }),
    http.get(`${API}/tasks/`, () => HttpResponse.json([])),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    requests = [];
    days = [];
    sessionQueries = [];
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map(cell => cell.textContent);

describe('hoursAndMinutes', () => {
    it('shows hours and minutes', () => {
        expect(hoursAndMinutes(0)).toBe('0m');
        expect(hoursAndMinutes(20)).toBe('<1m');
        expect(hoursAndMinutes(55 * 60)).toBe('55m');
        expect(hoursAndMinutes(2 * 3600)).toBe('2h');
        expect(hoursAndMinutes(7 * 3600 + 50 * 60 + 29)).toBe('7h 50m');
        expect(hoursAndMinutes(160 * 3600)).toBe('160h');
    });
});

describe('TimeSheet', () => {
    it('shows a row per day: begin, end, pause and working time, and the month in total', async () => {
        days = [wednesday, thursday];
        render(<TimeSheet initialMonth={new Date(2026, 9, 15)} />, { wrapper });

        const row = await screen.findByTestId('day-2026-10-07');
        expect(requests).toEqual(['2026-10-01..2026-10-31']);
        expect(cells(row).slice(2)).toEqual([clock(wednesday.begin), clock(wednesday.end), '55m', '7h 50m']);
        // Still being worked on.
        expect(within(screen.getByTestId('day-2026-10-08')).getByText('running')).toBeInTheDocument();
        expect(screen.getByTestId('day-2026-10-08')).toHaveTextContent('—'); // no pause
        expect(screen.getByTestId('time-sheet-total')).toHaveTextContent(/2 days.*55m.*10h 20m/);
        expect(screen.getByText(/tagged #Arbeit or #Work/)).toBeInTheDocument();
    });

    it('opens a day with its arrow: the tasks counted, their tags and time', async () => {
        days = [wednesday];
        render(<TimeSheet initialMonth={new Date(2026, 9, 1)} />, { wrapper });
        await screen.findByTestId('day-2026-10-07');
        expect(screen.queryByRole('table', { name: /tasks of/ })).toBeNull();

        const arrow = screen.getByRole('button', { name: /show the tasks of/ });
        expect(arrow).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(arrow);

        const tasks = await screen.findByRole('table', { name: /tasks of/ });
        const [, report, lunch] = within(tasks).getAllByRole('row');
        expect(cells(report)).toEqual(['Report', '#Arbeit', '5h 15m']);
        expect(cells(lunch)).toEqual(['Lunchpause', '#Freizeit', '55m']);
        expect(lunch).toHaveAttribute('data-kind', 'pause');

        fireEvent.click(screen.getByRole('button', { name: /hide the tasks of/ }));
        await waitFor(() => expect(screen.queryByRole('table', { name: /tasks of/ })).toBeNull());
    });

    it('marks an end after midnight: the day’s work went on into the night', async () => {
        days = [{ ...wednesday, end: local(8, 0, 45), working_seconds: 15 * 3600 }];
        render(<TimeSheet initialMonth={new Date(2026, 9, 1)} />, { wrapper });
        const row = await screen.findByTestId('day-2026-10-07');
        expect(cells(row)[3]).toBe(`${clock(local(8, 0, 45))}+1`);
        expect(within(row).getByTitle('the next day')).toBeInTheDocument();
    });

    it('goes from month to month', async () => {
        render(<TimeSheet initialMonth={new Date(2026, 9, 1)} />, { wrapper });
        await waitFor(() => expect(requests).toEqual(['2026-10-01..2026-10-31']));

        fireEvent.click(screen.getByRole('button', { name: 'previous month' }));
        await waitFor(() => expect(requests).toContain('2026-09-01..2026-09-30'));
        fireEvent.click(screen.getByRole('button', { name: 'next month' }));
        fireEvent.click(screen.getByRole('button', { name: 'next month' }));
        await waitFor(() => expect(requests).toContain('2026-11-01..2026-11-30'));
    });

    it('says how to get on it when nothing was tracked', async () => {
        render(<TimeSheet initialMonth={new Date(2026, 10, 1)} />, { wrapper });
        expect(await screen.findByText(/No work tracked in/)).toHaveTextContent(/tagged #Arbeit or #Work/);
        expect(screen.queryByTestId('time-sheet-total')).toBeNull();
    });

    it('edits the times of a day, and adds time for any day (README: Time sheet)', async () => {
        days = [wednesday];
        render(<TimeSheet initialMonth={new Date(2026, 9, 1)} />, { wrapper });
        fireEvent.click(await screen.findByRole('button', { name: /show the tasks of/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Edit the times of this day' }));

        expect(await screen.findByRole('dialog', { name: 'Tracked time' })).toBeInTheDocument();
        await waitFor(() => expect(sessionQueries).toEqual(['?from=2026-10-07&to=2026-10-07']));
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

        fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
        const dialog = await screen.findByRole('dialog', { name: 'Tracked time' });
        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        expect((within(dialog).getAllByLabelText('Day')[0] as HTMLInputElement).value).toBe(iso);
    });
});
