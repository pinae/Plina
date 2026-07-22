/**
 * Tags pane: lists the existing tags and offers a single floating
 * "add" button that opens the tag creation dialog.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import TagList from './TagList.tsx';
import type { Tag } from '../../types.ts';

const API = 'http://localhost:8000/api';

const tags: Tag[] = [
    { id: 'tag-1', name: 'deep-work', hex_color: '#123456' },
    { id: 'tag-2', name: 'errands', hex_color: '#abcdef' },
];

const server = setupServer(
    http.get(`${API}/tags/`, () => HttpResponse.json(tags)),
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

describe('TagList', () => {
    it('lists the existing tags', async () => {
        render(<TagList />, { wrapper });
        expect(await screen.findByText(/deep-work/)).toBeInTheDocument();
        expect(screen.getByText(/errands/)).toBeInTheDocument();
    });

    it('opens the new-tag dialog from the floating add button', async () => {
        render(<TagList />, { wrapper });
        await screen.findByText(/deep-work/);

        fireEvent.click(screen.getByRole('button', { name: /add tag/i }));

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(dialog).toHaveTextContent(/new tag/i));
    });
});
