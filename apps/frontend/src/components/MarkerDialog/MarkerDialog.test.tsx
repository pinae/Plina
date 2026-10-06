/**
 * Markers (README: Calendar): all day (from midnight to the midnight after
 * the last day) or at a time for a while; deletable, and convertible into a
 * special bucket.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { MarkerDialog } from './MarkerDialog.tsx';
import { API } from '../../testing/treeFixtures.ts';
import type { Marker } from '../../types.ts';

let requests: { method: string; path: string; body: Record<string, unknown> | null }[] = [];

const record = async (request: Request) => {
    const text = await request.text();
    requests.push({
        method: request.method, path: new URL(request.url).pathname.replace(/^\/api\//, ''),
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    });
};

const server = setupServer(
    http.post(`${API}/markers/`, async ({ request }) => {
        await record(request);
        return HttpResponse.json({}, { status: 201 });
    }),
    http.patch(`${API}/markers/:id/`, async ({ request }) => {
        await record(request);
        return HttpResponse.json({});
    }),
    http.delete(`${API}/markers/:id/`, async ({ request }) => {
        await record(request);
        return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${API}/markers/:id/convert/`, async ({ request }) => {
        await record(request);
        return HttpResponse.json({}, { status: 201 });
    }),
    http.get(`${API}/settings/`, () => HttpResponse.json({
        default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
        week_view_start: '08:00:00', week_view_end: '16:00:00',
    })),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.post(`${API}/recurrence-preview/`, () => HttpResponse.json({
        description: 'every day at 08:00', occurrences: [],
    })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    requests = [];
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const minutesBetween = (from: Date, until: Date) => Math.round((until.getTime() - from.getTime()) / 60000);

const conference: Marker = {
    id: 'm-1', title: 'Conference', description: '', place: 'Berlin',
    start: new Date(2026, 9, 20).toISOString(), duration: '3 00:00:00', end: new Date(2026, 9, 23).toISOString(),
    all_day: true, calendar: { id: 'cal-1', name: 'Google Calendar' }, deadline_task_count: 2,
};

describe('MarkerDialog', () => {
    it('creates an all-day marker over several days, from midnight to the midnight after', async () => {
        const onClose = vi.fn();
        render(<MarkerDialog day={new Date(2026, 9, 20, 15, 30)} onClose={onClose} />, { wrapper });

        expect(screen.getByRole('dialog')).toHaveTextContent('New marker');
        expect(field('First day').value).toBe('2026-10-20');
        expect(field('Last day').value).toBe('2026-10-20');
        fireEvent.change(field(/Title/), { target: { value: ' Conference ' } });
        fireEvent.change(field('Last day'), { target: { value: '2026-10-22' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(requests).toHaveLength(1));
        const from = new Date(2026, 9, 20);
        const hours = minutesBetween(from, new Date(2026, 9, 23)) / 60;
        expect(requests[0]).toMatchObject({
            method: 'POST', path: 'markers/',
            body: { title: 'Conference', start: from.toISOString(), duration: `${hours}:00:00` },
        });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('creates a marker at a moment (a deadline) when the duration stays empty', async () => {
        render(<MarkerDialog day={new Date(2026, 9, 20)} onClose={() => {}} />, { wrapper });

        fireEvent.change(field(/Title/), { target: { value: 'Paper deadline' } });
        fireEvent.click(screen.getByLabelText('All day'));
        expect(field('At').value).toBe('2026-10-20T12:00');
        fireEvent.change(field('At'), { target: { value: '2026-10-20T23:59' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].body).toMatchObject({
            title: 'Paper deadline', start: new Date(2026, 9, 20, 23, 59).toISOString(), duration: '00:00:00',
        });
    });

    it('says what is wrong instead of saving', async () => {
        render(<MarkerDialog day={new Date(2026, 9, 20)} onClose={() => {}} />, { wrapper });

        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        expect(screen.getByText(/title is empty/)).toBeInTheDocument();

        fireEvent.change(field(/Title/), { target: { value: 'Talk' } });
        fireEvent.click(screen.getByLabelText('All day'));
        fireEvent.change(field('Duration (hours)'), { target: { value: 'soon' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        expect(screen.getByText(/“soon” is not a duration/)).toBeInTheDocument();
        expect(requests).toHaveLength(0);
    });

    it('edits a marker from a calendar, prefilled with its days', async () => {
        render(<MarkerDialog marker={conference} onClose={() => {}} />, { wrapper });

        expect(screen.getByRole('dialog')).toHaveTextContent('Marker “Conference”');
        expect(field('First day').value).toBe('2026-10-20');
        expect(field('Last day').value).toBe('2026-10-22');
        expect(screen.getByText(/From Google Calendar/)).toBeInTheDocument();
        expect(screen.getByText(/deadline of 2 tasks/)).toBeInTheDocument();

        fireEvent.change(field('Place'), { target: { value: 'Berlin, ICC' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0]).toMatchObject({ method: 'PATCH', path: 'markers/m-1/', body: { place: 'Berlin, ICC' } });
    });

    it('deletes a marker', async () => {
        const onClose = vi.fn();
        render(<MarkerDialog marker={conference} onClose={onClose} />, { wrapper });

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(requests).toEqual([{ method: 'DELETE', path: 'markers/m-1/', body: null }]));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('makes a special bucket of a marker, over its time frame', async () => {
        const onClose = vi.fn();
        render(<MarkerDialog marker={conference} onClose={onClose} />, { wrapper });

        fireEvent.click(screen.getByRole('button', { name: 'Make special bucket' }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('Make “Conference” a special bucket');
        expect(field('Name').value).toBe('Conference');
        expect(field('From').value).toBe('2026-10-20T00:00');
        expect(field('Until').value).toBe('2026-10-23T00:00');
        // Each day the usual Week view hours, once the settings are there.
        await waitFor(() => expect(field('Duration (hours)').value).toBe('8'));
        fireEvent.click(screen.getByRole('button', { name: 'Make special bucket' }));

        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0]).toMatchObject({
            method: 'POST', path: 'markers/m-1/convert/',
            body: {
                name: 'Conference', special_start: conference.start, special_end: conference.end,
            },
        });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});
