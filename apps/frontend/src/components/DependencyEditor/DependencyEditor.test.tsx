import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from '../../theme.ts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { TaskNodeCard } from '../TaskNode/TaskNode.tsx';
import DependencyEditor from './DependencyEditor.tsx';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';
import { makeTask, makerTag, settingsFor } from '../../testing/treeFixtures.ts';
import { EMPTY_FILTER, storeFilter } from '../../utils/taskFilter.ts';
import type { Dependency, Task } from '../../types.ts';

describe('TaskNodeCard', () => {
    it('shows header and duration chip with the task color bar', () => {
        render(
            <TaskNodeCard
                header="Design Schema"
                durationLabel="3h"
                color="#3357ff"
                projectName="Webshop"
                isDone={false}
            />,
        );

        expect(screen.getByText('Design Schema')).toBeInTheDocument();
        expect(screen.getByText('3h')).toBeInTheDocument();
        const bar = screen.getByTestId('task-color-bar');
        expect(bar).toHaveStyle({ backgroundColor: '#3357ff' });
    });

    it('greys out completed tasks', () => {
        render(
            <TaskNodeCard
                header="Old One" durationLabel="1h"
                color={null} projectName={null} isDone={true}
            />,
        );

        const card = screen.getByTestId('task-node-card');
        expect(card).toHaveStyle({ opacity: '0.45' });
    });
});

const API = 'http://localhost:8000/api';

const twoTasks = (): Task[] => [
    makeTask('t1', { header: 'Upgrade Django', duration: '02:00:00', priority: 8 }),
    makeTask('t2', { header: 'Design Schema', duration: '03:00:00', priority: 9 }),
];
let tasks: Task[] = twoTasks();
let dependencies: Dependency[] = [{ id: 'd1', predecessor: 't1', successor: 't2' }];

const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json(tasks)),
    http.get(`${API}/dependencies/`, () => HttpResponse.json(dependencies)),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settingsFor(tasks, null))),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    tasks = twoTasks();
    dependencies = [{ id: 'd1', predecessor: 't1', successor: 't2' }];
    localStorage.clear();
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return (
        <ThemeProvider theme={appTheme}>
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </ThemeProvider>
    );
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

describe('DependencyEditor theming', () => {
    it('renders React Flow in dark mode to match the app theme', async () => {
        const { container } = render(<DependencyEditor />, { wrapper });
        await waitFor(() =>
            expect(screen.getByText('Upgrade Django')).toBeInTheDocument(),
        );
        expect(container.querySelector('.react-flow')?.classList.contains('dark')).toBe(true);
    });
});

describe('filtering (README: Filtering tasks)', () => {
    beforeEach(() => {
        // A chain A → B → C, and X on its own; B carries #maker.
        tasks = [
            makeTask('a', { header: 'Order parts' }),
            makeTask('b', { header: 'Assemble frame', tags: [makerTag] }),
            makeTask('c', { header: 'Test drive' }),
            makeTask('x', { header: 'Write invoice' }),
        ];
        dependencies = [
            { id: 'ab', predecessor: 'a', successor: 'b' },
            { id: 'bc', predecessor: 'b', successor: 'c' },
        ];
    });
    const card = (name: string) => screen.getByText(name).closest('[data-testid="task-node-card"]');

    it('shows the tasks that pass and greys the tasks linked to them', async () => {
        render(<DependencyEditor />, { wrapper });
        await screen.findByText('Write invoice');
        fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'frame' } });
        await waitFor(() => expect(screen.queryByText('Write invoice')).toBeNull());
        expect(screen.getAllByTestId('task-node-card')).toHaveLength(3);
        expect(card('Assemble frame')).not.toHaveAttribute('data-dimmed');
        expect(card('Order parts')).toHaveAttribute('data-dimmed', 'true');
        expect(card('Test drive')).toHaveAttribute('data-dimmed', 'true');
        expect(screen.getByText('1 of 4 tasks')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('switch', { name: 'Show linked tasks' }));
        await waitFor(() => expect(screen.getAllByTestId('task-node-card')).toHaveLength(1));
        expect(screen.getByText('Assemble frame')).toBeInTheDocument();
    });

    it('uses the filter of the Tasks tab', async () => {
        storeFilter({ ...EMPTY_FILTER, tags: [makerTag.id] });
        render(<DependencyEditor />, { wrapper });
        await screen.findByText('Assemble frame');
        expect(screen.queryByText('Write invoice')).toBeNull();
        expect(screen.getByRole('button', { name: 'Tag: #maker' })).toBeInTheDocument();
    });

    it('says when nothing passes', async () => {
        storeFilter({ ...EMPTY_FILTER, search: 'nothing like this' });
        render(<DependencyEditor />, { wrapper });
        expect(await screen.findByText('No tasks match the filter.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
        expect(await screen.findByText('Write invoice')).toBeInTheDocument();
    });

    it('on phones: the filters and "Show linked tasks" in the sheet, no mini map', async () => {
        const restore = fakeScreen(PHONE);
        try {
            const { container } = render(<DependencyEditor />, { wrapper });
            await screen.findByText('Write invoice');
            expect(container.querySelector('.react-flow__minimap')).toBeNull();
            expect(screen.queryByRole('switch', { name: 'Show linked tasks' })).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'filters' }));
            const sheet = await screen.findByRole('dialog', { name: 'Filters' });
            expect(within(sheet).getByRole('switch', { name: 'Show linked tasks' })).toBeChecked();
        } finally {
            restore();
        }
    });
});
