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

const API = 'http://localhost:8000/api';

let bucketTypes: TimeBucketType[] = [];
let patched: Record<string, unknown>[] = [];

const server = setupServer(
    http.get(`${API}/buckettypes/`, () => HttpResponse.json(bucketTypes)),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.patch(`${API}/buckettypes/1/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patched.push(body);
        return HttpResponse.json({ id: 1, ...body });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    bucketTypes = [];
    patched = [];
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
        duration: '04:00:00', tags: [], hex_color: '#4caf50',
    },
    {
        id: 2, name: 'Evening Errands', start_times: 'every day at 18:00',
        duration: '01:30:00', tags: [], hex_color: null,
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
});
