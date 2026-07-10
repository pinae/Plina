import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { TaskNodeCard } from './TaskNode';
import DependencyEditor from './DependencyEditor';

describe('TaskNodeCard', () => {
    it('shows header and duration chip with the project color bar', () => {
        render(
            <TaskNodeCard
                header="Design Schema"
                durationLabel="3h"
                projectColor="#3357ff"
                projectName="Webshop"
                isDone={false}
            />,
        );

        expect(screen.getByText('Design Schema')).toBeInTheDocument();
        expect(screen.getByText('3h')).toBeInTheDocument();
        const bar = screen.getByTestId('project-color-bar');
        expect(bar).toHaveStyle({ backgroundColor: '#3357ff' });
    });

    it('greys out completed tasks', () => {
        render(
            <TaskNodeCard
                header="Old One" durationLabel="1h"
                projectColor={null} projectName={null} isDone={true}
            />,
        );

        const card = screen.getByTestId('task-node-card');
        expect(card).toHaveStyle({ opacity: '0.45' });
    });
});

const API = 'http://localhost:8000/api';

const server = setupServer(
    http.get(`${API}/tasks/`, () =>
        HttpResponse.json([
            {
                id: 't1', header: 'Upgrade Django', description: '',
                start_date: null, duration: '02:00:00', latest_finish_date: null,
                time_spent: '00:00:00', priority: 8, tags: [], hex_color: null,
                is_fixed: false, is_appointment: false, completed_at: null,
                is_done: false, active_tracking_start: null,
            },
            {
                id: 't2', header: 'Design Schema', description: '',
                start_date: null, duration: '03:00:00', latest_finish_date: null,
                time_spent: '00:00:00', priority: 9, tags: [], hex_color: null,
                is_fixed: false, is_appointment: false, completed_at: null,
                is_done: false, active_tracking_start: null,
            },
        ]),
    ),
    http.get(`${API}/dependencies/`, () =>
        HttpResponse.json([{ id: 'd1', predecessor: 't1', successor: 't2' }]),
    ),
    http.get(`${API}/projects/`, () =>
        HttpResponse.json([
            {
                id: 'p1', name: 'Refactor Backend', description: '', tags: [],
                priority: 8, order: 0, task_ids: ['t1', 't2'], hex_color: '#3357ff',
            },
        ]),
    ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('DependencyEditor', () => {
    it('renders the fetched DAG as task nodes', async () => {
        render(<DependencyEditor />, { wrapper });

        await waitFor(() =>
            expect(screen.getByText('Upgrade Django')).toBeInTheDocument(),
        );
        expect(screen.getByText('Design Schema')).toBeInTheDocument();
        expect(screen.getAllByTestId('task-node-card')).toHaveLength(2);
    });
});
