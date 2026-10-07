/**
 * Merging two tasks (README: Calendar): the kept task left, the other right,
 * the result in the middle; arrows copy fields, "Merge" posts the result.
 * Without a second task the dialog compares a task with its calendar event.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { MergeDialog } from './MergeDialog.tsx';
import { keptOf } from '../../utils/merge.ts';
import { API, makeTask } from '../../testing/treeFixtures.ts';
import type { Task, TaskCalendar } from '../../types.ts';

const calendar = (over: Partial<TaskCalendar> = {}): TaskCalendar => ({
    id: 'link-1', name: 'Google Calendar', pending: [],
    event: {
        header: 'Project kickoff', description: 'Agenda in the invite', place: 'Room 4.12',
        start: '2026-10-14T08:00:00Z', end: '2026-10-14T09:30:00Z', all_day: false,
    },
    ...over,
});

const mine = makeTask('mine', {
    header: 'Kickoff', description: 'Bring the slides', place: '', is_appointment: true,
    start_date: '2026-10-14T08:00:00Z', duration: '01:00:00', priority: 8,
});
const imported = makeTask('imported', {
    header: 'Project kickoff', description: 'Agenda in the invite', place: 'Room 4.12', is_appointment: true,
    start_date: '2026-10-14T08:00:00Z', duration: '01:30:00', calendar: calendar(),
});

let merges: { id: string; body: Record<string, unknown> }[] = [];
let patches: { id: string; body: Record<string, unknown> }[] = [];
let mergeAnswer: () => Response = () => HttpResponse.json({ task: mine, notes: [] });

const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json([mine, imported])),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.get(`${API}/plan/`, () => HttpResponse.json({ tasks: [], buckets: [] })),
    http.get(`${API}/dependencies/`, () => HttpResponse.json([])),
    http.get(`${API}/settings/`, () => HttpResponse.json({})),
    http.post(`${API}/tasks/:id/merge/`, async ({ params, request }) => {
        merges.push({ id: String(params.id), body: (await request.json()) as Record<string, unknown> });
        return mergeAnswer();
    }),
    http.patch(`${API}/tasks/:id/`, async ({ params, request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push({ id: String(params.id), body });
        return HttpResponse.json({ ...mine, ...body });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    merges = [];
    patches = [];
    mergeAnswer = () => HttpResponse.json({ task: mine, notes: [] });
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const result = (label: string) => screen.getByLabelText(`merged ${label}`) as HTMLInputElement;

describe('keptOf', () => {
    it('keeps your own task, whichever way the drag went', () => {
        expect(keptOf(imported, mine)).toEqual({ kept: mine, other: imported });
        expect(keptOf(mine, imported)).toEqual({ kept: mine, other: imported });
    });

    it('keeps the drop target when both are yours', () => {
        const other = makeTask('other');
        expect(keptOf(other, mine)).toEqual({ kept: mine, other });
    });
});

describe('MergeDialog', () => {
    it('shows both tasks side by side and marks the fields that differ', async () => {
        render(<MergeDialog kept={mine} other={imported} onClose={() => {}} />, { wrapper });

        expect(screen.getByRole('dialog')).toHaveTextContent('Merge two tasks');
        expect(screen.getByTestId('merge-row-header')).toHaveAttribute('data-differs', 'true');
        expect(screen.getByTestId('merge-row-duration')).toHaveAttribute('data-differs', 'true');
        expect(screen.getByTestId('merge-row-start_date')).not.toHaveAttribute('data-differs');
        // The other task's calendar link moves over: said up front.
        expect(screen.getByRole('dialog')).toHaveTextContent(/link to Google Calendar moves over/);
    });

    it('starts from the kept task, its empty fields filled from the other', () => {
        render(<MergeDialog kept={mine} other={imported} onClose={() => {}} />, { wrapper });

        expect(result('Title').value).toBe('Kickoff');
        expect(result('Description').value).toBe('Bring the slides');
        expect(result('Place').value).toBe('Room 4.12');
        expect(screen.getByTestId('merge-result-duration')).toHaveTextContent('1h');
    });

    it('copies fields with the arrows, lets the result be edited and posts it', async () => {
        const onMerged = vi.fn();
        const onClose = vi.fn();
        render(<MergeDialog kept={mine} other={imported} onClose={onClose} onMerged={onMerged} />, { wrapper });

        fireEvent.click(screen.getByRole('button', { name: 'take Title from the right' }));
        expect(result('Title').value).toBe('Project kickoff');
        fireEvent.click(screen.getByRole('button', { name: 'take Duration from the right' }));
        expect(screen.getByTestId('merge-result-duration')).toHaveTextContent('1h 30m');
        fireEvent.change(result('Description'), { target: { value: 'Bring the slides\nAgenda in the invite' } });
        fireEvent.click(screen.getByRole('button', { name: 'take Title from the left' }));
        expect(result('Title').value).toBe('Kickoff');

        fireEvent.click(screen.getByRole('button', { name: 'Merge' }));

        await waitFor(() => expect(merges).toHaveLength(1));
        expect(merges[0].id).toBe('mine');
        expect(merges[0].body.other_id).toBe('imported');
        expect(merges[0].body.values).toMatchObject({
            header: 'Kickoff', description: 'Bring the slides\nAgenda in the invite', place: 'Room 4.12',
            duration: '01:30:00', is_appointment: true, priority: 8, deadline_marker_id: null,
        });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(onMerged).toHaveBeenCalledWith(mine, []);
    });

    it('refuses an empty title and shows why the server refused', async () => {
        mergeAnswer = () => HttpResponse.json({ detail: 'Both come from a calendar.' }, { status: 400 });
        render(<MergeDialog kept={mine} other={imported} onClose={() => {}} />, { wrapper });

        fireEvent.change(result('Title'), { target: { value: '  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
        expect(await screen.findByText(/title is empty/)).toBeInTheDocument();
        expect(merges).toHaveLength(0);

        fireEvent.change(result('Title'), { target: { value: 'Kickoff' } });
        fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
        expect(await screen.findByText('Both come from a calendar.')).toBeInTheDocument();
    });

    it('compares a task with its calendar event and settles it on save', async () => {
        const changed = makeTask('mine', {
            ...mine, calendar: calendar({ pending: ['header'] }),
        }) satisfies Task;
        const onClose = vi.fn();
        render(<MergeDialog kept={changed} onClose={onClose} />, { wrapper });

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Compare “Kickoff” with Google Calendar');
        // Only what an event says, the title marked as changed there.
        expect(screen.queryByTestId('merge-row-priority')).not.toBeInTheDocument();
        expect(within(screen.getByTestId('merge-row-header')).getByText('changed')).toBeInTheDocument();
        expect(result('Title').value).toBe('Kickoff');

        fireEvent.click(screen.getByRole('button', { name: 'take Title from the right' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0].id).toBe('mine');
        expect(patches[0].body).toMatchObject({ header: 'Project kickoff', calendar_resolved: true });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});
