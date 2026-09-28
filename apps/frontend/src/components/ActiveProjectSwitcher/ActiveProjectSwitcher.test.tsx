import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ActiveProjectSwitcher } from './ActiveProjectSwitcher.tsx';
import { API, makeTask, settingsFor, treeTasks } from '../../testing/treeFixtures.ts';
import type { SettingsWrite } from '../../types.ts';

let tasks = treeTasks();
let settings = settingsFor(tasks, 'hw');
const patches: SettingsWrite[] = [];
const created: unknown[] = [];

const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json(tasks)),
    http.get(`${API}/settings/`, () => HttpResponse.json(settings)),
    http.patch(`${API}/settings/`, async ({ request }) => {
        const patch = await request.json() as SettingsWrite;
        patches.push(patch);
        settings = settingsFor(tasks, patch.active_task_id ?? null);
        return HttpResponse.json(settings);
    }),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = await request.json() as { header: string };
        created.push(body);
        const task = makeTask('new-1', { header: body.header });
        tasks = [...tasks, task];
        return HttpResponse.json(task, { status: 201 });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    cleanup();
    server.resetHandlers();
    tasks = treeTasks();
    settings = settingsFor(tasks, 'hw');
    patches.length = 0;
    created.length = 0;
    localStorage.clear();
});
afterAll(() => server.close());

function Harness({ onShowAll = vi.fn() }: { onShowAll?: () => void }) {
    const [open, setOpen] = useState(false);
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return (
        <QueryClientProvider client={client}>
            <ActiveProjectSwitcher open={open} onOpenChange={setOpen} onShowAllProjects={onShowAll} />
        </QueryClientProvider>
    );
}

const openPicker = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /change active project/i }));
    return screen.findByRole('combobox');
};

describe('ActiveProjectSwitcher', () => {
    it('shows the active project as a breadcrumb', async () => {
        render(<Harness />);
        const crumbs = await screen.findByRole('navigation', { name: /active project/i });
        await waitFor(() => expect(crumbs).toHaveTextContent('T250›Hardware Design'));
    });

    it('widens the scope when an ancestor in the breadcrumb is clicked', async () => {
        render(<Harness />);
        fireEvent.click(await screen.findByRole('button', { name: 'T250' }));
        await waitFor(() => expect(patches).toEqual([{ active_task_id: 't250' }]));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'T250' })).toBeNull());
    });

    it('picks another project by typing and Enter', async () => {
        render(<Harness />);
        const input = await openPicker();
        fireEvent.change(input, { target: { value: 'blog' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(patches).toEqual([{ active_task_id: 'blog' }]));
        await waitFor(() => expect(screen.getByRole('navigation', { name: /active project/i }))
            .toHaveTextContent('Company Blog'));
    });

    it('offers "No project"', async () => {
        render(<Harness />);
        await openPicker();
        fireEvent.click(await screen.findByRole('option', { name: /no project/i }));
        await waitFor(() => expect(patches).toEqual([{ active_task_id: null }]));
    });

    it('lists projects and sub-projects but no single steps', async () => {
        render(<Harness />);
        await openPicker();
        const options = (await screen.findAllByRole('option')).map(o => o.textContent);
        expect(options.join('|')).toContain('Hardware Design');
        expect(options.join('|')).not.toContain('CAD');
    });

    it('creates and activates a new project from the typed text', async () => {
        render(<Harness />);
        const input = await openPicker();
        fireEvent.change(input, { target: { value: 'Garden shed' } });
        fireEvent.click(await screen.findByRole('option', { name: /new project “Garden shed”/i }));
        await waitFor(() => expect(created).toEqual([{ header: 'Garden shed', parent_id: null }]));
        await waitFor(() => expect(patches).toEqual([{ active_task_id: 'new-1' }]));
    });

    it('links to the list of all projects', async () => {
        const onShowAll = vi.fn();
        render(<Harness onShowAll={onShowAll} />);
        await openPicker();
        fireEvent.click(screen.getByRole('button', { name: /show all projects/i }));
        expect(onShowAll).toHaveBeenCalled();
    });

    it('lists recently active projects first', async () => {
        localStorage.setItem('plina.recentProjects', JSON.stringify(['blog']));
        render(<Harness />);
        await openPicker();
        const options = (await screen.findAllByRole('option')).map(o => o.textContent ?? '');
        expect(options[0]).toMatch(/no project/i);
        expect(options[1]).toContain('Company Blog');
    });
});
