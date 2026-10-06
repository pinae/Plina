/**
 * Time Buckets pane: lists the existing time buckets, offers a single floating
 * "add" button that opens the creation dialog, and edits a bucket when its row
 * is clicked.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import BucketTypeList from './BucketTypeList.tsx';
import type { TimeBucketType } from '../../types.ts';
import { calendarHandlers } from '../../testing/calendarHandlers.ts';

const API = 'http://localhost:8000/api';

let bucketTypes: TimeBucketType[] = [];
let patched: Record<string, unknown>[] = [];
let created: Record<string, unknown>[] = [];

const server = setupServer(
    ...calendarHandlers(),
    http.get('http://localhost:8000/api/settings/', () => HttpResponse.json({
        default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
        week_view_start: '08:00:00', week_view_end: '16:45:00',
    })),
    http.get(`${API}/buckettypes/`, () => HttpResponse.json(bucketTypes)),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.patch(`${API}/buckettypes/1/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patched.push(body);
        return HttpResponse.json({ id: 1, ...body });
    }),
    http.post(`${API}/buckettypes/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        created.push(body);
        return HttpResponse.json({ id: 9, ...body }, { status: 201 });
    }),
    http.post(`${API}/recurrence-preview/`, () => HttpResponse.json({ description: 'every day at 08:00', occurrences: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    bucketTypes = [];
    patched = [];
    created = [];
});
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

const sample: TimeBucketType[] = [
    {
        id: 1, name: 'Morning Focus', start_times: 'every weekday at 09:00',
        duration: '04:00:00', tags: [], hex_color: '#4caf50', own_hex_color: '#4caf50', auto_hex_color: '#299fcd',
    },
    {
        id: 2, name: 'Evening Errands', start_times: 'every day at 18:00',
        duration: '01:30:00', tags: [], hex_color: null, own_hex_color: null, auto_hex_color: null,
    },
];

describe('BucketTypeList', () => {
    it('lists the existing time buckets', async () => {
        bucketTypes = sample;
        render(<BucketTypeList />, { wrapper });
        expect(await screen.findByText('Morning Focus')).toBeInTheDocument();
        expect(screen.getByText('Evening Errands')).toBeInTheDocument();
        expect(screen.getByText(/every weekday at 09:00/)).toBeInTheDocument();
    });

    it('opens the new-bucket dialog (labelled "New time bucket") from the add button', async () => {
        bucketTypes = sample;
        render(<BucketTypeList />, { wrapper });
        await screen.findByText('Morning Focus');

        fireEvent.click(screen.getByRole('button', { name: /add bucket/i }));

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(dialog).toHaveTextContent(/new time bucket/i));
        // Must not be the old "New time bucket type" wording.
        expect(dialog).not.toHaveTextContent(/time bucket type/i);
    });

    it('edits an existing bucket when its row is clicked, prefilled', async () => {
        bucketTypes = sample;
        render(<BucketTypeList />, { wrapper });

        fireEvent.click(await screen.findByText('Morning Focus'));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent(/edit time bucket/i);
        const name = within(dialog).getByLabelText(/name/i) as HTMLInputElement;
        expect(name.value).toBe('Morning Focus');

        fireEvent.change(name, { target: { value: 'Deep Work' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));

        await waitFor(() => expect(patched).toHaveLength(1));
        expect(patched[0]).toMatchObject({ name: 'Deep Work' });
    });

    it('lists special buckets apart, with their time frame and calendar', async () => {
        bucketTypes = [...sample, {
            id: 3, name: 'Hackathon', start_times: '', duration: '1 00:00:00', tags: [],
            hex_color: '#ff9800', own_hex_color: null, auto_hex_color: '#ff9800',
            special_start: '2026-11-06T08:00:00Z', special_end: '2026-11-08T18:00:00Z', is_special: true,
            calendar: { id: 'cal-1', name: 'Google Calendar' },
        }];
        render(<BucketTypeList />, { wrapper });

        expect(await screen.findByText('Hackathon')).toBeInTheDocument();
        expect(screen.getByText(/the whole time/)).toBeInTheDocument();
        expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    });

    it('adds a special bucket: from tomorrow for a day, the Week view hours each day', async () => {
        render(<BucketTypeList />, { wrapper });
        await screen.findByText(/No special buckets/);

        fireEvent.click(screen.getByRole('button', { name: 'Add special bucket' }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('New special bucket');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        expect((within(dialog).getByLabelText('From') as HTMLInputElement).value).toBe(`${day(tomorrow)}T00:00`);
        await waitFor(() => expect((within(dialog).getByLabelText(/Within it/) as HTMLInputElement).value)
            .toBe('every day at 08:00'));
        expect((within(dialog).getByLabelText('Duration (hours)') as HTMLInputElement).value).toBe('8.75');
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Hackathon' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(created).toHaveLength(1));
        expect(created[0]).toMatchObject({
            name: 'Hackathon', start_times: 'every day at 08:00', duration: '08:45:00',
            special_start: tomorrow.toISOString(),
        });
    });
});
