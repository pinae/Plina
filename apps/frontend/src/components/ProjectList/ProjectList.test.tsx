/**
 * Projects pane: lists the existing projects, offers a single floating "add"
 * button that opens the project creation dialog, and edits a project when its
 * row is clicked.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import ProjectList from './ProjectList.tsx';
import type { Project } from '../../types.ts';

const API = 'http://localhost:8000/api';

let projects: Project[] = [];
let patched: Record<string, unknown>[] = [];

const server = setupServer(
    http.get(`${API}/projects/`, () => HttpResponse.json(projects)),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.patch(`${API}/projects/proj-1/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patched.push(body);
        return HttpResponse.json({ id: 'proj-1', ...body });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    projects = [];
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

const sample: Project[] = [
    {
        id: 'proj-1', name: 'Webshop', description: 'Online store',
        tags: [], priority: 8, order: 0, task_ids: [], hex_color: '#336699',
    },
    {
        id: 'proj-2', name: 'Garden', description: '',
        tags: [], priority: 3, order: 1, task_ids: [], hex_color: null,
    },
];

describe('ProjectList', () => {
    it('lists the existing projects', async () => {
        projects = sample;
        render(<ProjectList />, { wrapper });
        expect(await screen.findByText('Webshop')).toBeInTheDocument();
        expect(screen.getByText('Garden')).toBeInTheDocument();
    });

    it('opens the new-project dialog from the floating add button', async () => {
        projects = sample;
        render(<ProjectList />, { wrapper });
        await screen.findByText('Webshop');

        fireEvent.click(screen.getByRole('button', { name: /add project/i }));

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(dialog).toHaveTextContent(/new project/i));
    });

    it('edits an existing project when its row is clicked, prefilled', async () => {
        projects = sample;
        render(<ProjectList />, { wrapper });

        fireEvent.click(await screen.findByText('Webshop'));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent(/edit project/i);
        const name = within(dialog).getByLabelText(/name/i) as HTMLInputElement;
        expect(name.value).toBe('Webshop');

        fireEvent.change(name, { target: { value: 'Webshop v2' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));

        await waitFor(() => expect(patched).toHaveLength(1));
        expect(patched[0]).toMatchObject({ name: 'Webshop v2' });
    });
});
