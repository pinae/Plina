/**
 * Tags pane: lists the existing tags, offers a single floating "add" button
 * that opens the tag creation dialog, and edits a tag when its row is clicked.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import TagList from './TagList.tsx';
import type { Tag } from '../../types.ts';

const API = 'http://localhost:8000/api';

let tags: Tag[] = [];
let patched: Record<string, unknown>[] = [];

const server = setupServer(
    http.get(`${API}/tags/`, () => HttpResponse.json(tags)),
    http.patch(`${API}/tags/tag-1/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patched.push(body);
        return HttpResponse.json({ id: 'tag-1', ...body });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    tags = [];
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

describe('TagList', () => {
    it('lists the existing tags', async () => {
        tags = [
            { id: 'tag-1', name: 'deep-work', hex_color: '#123456' },
            { id: 'tag-2', name: 'errands', hex_color: '#abcdef' },
        ];
        render(<TagList />, { wrapper });
        expect(await screen.findByText(/deep-work/)).toBeInTheDocument();
        expect(screen.getByText(/errands/)).toBeInTheDocument();
    });

    it('opens the new-tag dialog from the floating add button', async () => {
        tags = [{ id: 'tag-1', name: 'deep-work', hex_color: '#123456' }];
        render(<TagList />, { wrapper });
        await screen.findByText(/deep-work/);

        fireEvent.click(screen.getByRole('button', { name: /add tag/i }));

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(dialog).toHaveTextContent(/new tag/i));
    });

    it('edits an existing tag when its row is clicked, prefilled', async () => {
        tags = [{ id: 'tag-1', name: 'deep-work', hex_color: '#123456' }];
        render(<TagList />, { wrapper });

        fireEvent.click(await screen.findByText(/deep-work/));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent(/edit tag/i);
        const name = within(dialog).getByLabelText(/name/i) as HTMLInputElement;
        expect(name.value).toBe('deep-work');

        fireEvent.change(name, { target: { value: 'focus' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));

        await waitFor(() => expect(patched).toHaveLength(1));
        expect(patched[0]).toMatchObject({ name: 'focus' });
    });
});
