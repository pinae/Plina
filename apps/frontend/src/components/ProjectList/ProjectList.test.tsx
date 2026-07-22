/**
 * Projects pane: lists the existing projects and offers a single floating
 * "add" button that opens the project creation dialog.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import ProjectList from './ProjectList.tsx';
import type { Project } from '../../types.ts';

const API = 'http://localhost:8000/api';

const projects: Project[] = [
    {
        id: 'proj-1', name: 'Webshop', description: 'Online store',
        tags: [], priority: 8, order: 0, task_ids: [], hex_color: '#336699',
    },
    {
        id: 'proj-2', name: 'Garden', description: '',
        tags: [], priority: 3, order: 1, task_ids: [], hex_color: null,
    },
];

const server = setupServer(
    http.get(`${API}/projects/`, () => HttpResponse.json(projects)),
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

describe('ProjectList', () => {
    it('lists the existing projects', async () => {
        render(<ProjectList />, { wrapper });
        expect(await screen.findByText('Webshop')).toBeInTheDocument();
        expect(screen.getByText('Garden')).toBeInTheDocument();
    });

    it('opens the new-project dialog from the floating add button', async () => {
        render(<ProjectList />, { wrapper });
        await screen.findByText('Webshop');

        fireEvent.click(screen.getByRole('button', { name: /add project/i }));

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(dialog).toHaveTextContent(/new project/i));
    });
});
