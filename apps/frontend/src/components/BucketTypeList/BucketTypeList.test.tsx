/**
 * Time Buckets pane: lists the existing time bucket types and offers a single
 * floating "add" button that opens the bucket type creation dialog.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import BucketTypeList from './BucketTypeList.tsx';
import type { TimeBucketType } from '../../types.ts';

const API = 'http://localhost:8000/api';

const bucketTypes: TimeBucketType[] = [
    {
        id: 1, name: 'Morning Focus', start_times: 'every weekday at 09:00',
        duration: '04:00:00', tags: [], hex_color: '#4caf50',
    },
    {
        id: 2, name: 'Evening Errands', start_times: 'every day at 18:00',
        duration: '01:30:00', tags: [], hex_color: null,
    },
];

const server = setupServer(
    http.get(`${API}/buckettypes/`, () => HttpResponse.json(bucketTypes)),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
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

describe('BucketTypeList', () => {
    it('lists the existing time bucket types', async () => {
        render(<BucketTypeList />, { wrapper });
        expect(await screen.findByText('Morning Focus')).toBeInTheDocument();
        expect(screen.getByText('Evening Errands')).toBeInTheDocument();
        expect(screen.getByText(/every weekday at 09:00/)).toBeInTheDocument();
    });

    it('opens the new-bucket-type dialog from the floating add button', async () => {
        render(<BucketTypeList />, { wrapper });
        await screen.findByText('Morning Focus');

        fireEvent.click(screen.getByRole('button', { name: /add bucket type/i }));

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(dialog).toHaveTextContent(/new time bucket type/i));
    });
});
