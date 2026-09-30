import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { QuickAdd } from './QuickAdd.tsx';
import { API, makeTask, makerTag, settingsFor, treeTasks } from '../../testing/treeFixtures.ts';
import type { Task, TaskWrite } from '../../types.ts';

let posted: TaskWrite[] = [];
let patched: { id: string; body: TaskWrite }[] = [];
let tagPosts: string[] = [];
let parentAfterSave: Partial<Task> = {};

const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json(treeTasks())),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settingsFor(treeTasks(), 'hw'))),
    http.get(`${API}/plan/`, () => HttpResponse.json({ accepted_plan_id: null, warnings: [], appointments: [], buckets: [] })),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = await request.json() as TaskWrite;
        posted.push(body);
        return HttpResponse.json(makeTask('new-task', { header: body.header }), { status: 201 });
    }),
    http.get(`${API}/tasks/:id/`, ({ params }) => {
        const base = treeTasks().find(t => t.id === params.id)!;
        return HttpResponse.json({ ...base, ...parentAfterSave });
    }),
    http.patch(`${API}/tasks/:id/`, async ({ params, request }) => {
        patched.push({ id: String(params.id), body: await request.json() as TaskWrite });
        return HttpResponse.json(treeTasks().find(t => t.id === params.id));
    }),
    http.post(`${API}/tags/`, async ({ request }) => {
        const { name } = await request.json() as { name: string };
        tagPosts.push(name);
        return HttpResponse.json({ id: `tag-${name}`, name, hex_color: '#000000' }, { status: 201 });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    cleanup();
    server.resetHandlers();
    posted = []; patched = []; tagPosts = []; parentAfterSave = {};
});
afterAll(() => server.close());

function renderQuickAdd(onOpenTask = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><QuickAdd onOpenTask={onOpenTask} /></QueryClientProvider>);
    return screen.getByRole('textbox', { name: /add task/i });
}

/** Type and wait until tasks/tags/settings are loaded (chip is no longer "Loading…"). */
async function type(input: HTMLElement, text: string) {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    await waitFor(() => expect(screen.getByTestId('quick-add-project')).not.toHaveTextContent('Loading'));
}

describe('QuickAdd', () => {
    it('adds a task to the active project in one line (spec scenario 1)', async () => {
        const input = renderQuickAdd();
        // A direct DOM focus runs React focus handlers: wrap it in act().
        act(() => input.focus());
        await type(input, 'Order filament 30m #maker');
        expect(screen.getByTestId('quick-add-project')).toHaveTextContent('T250 › Hardware Design');
        expect(screen.getByText('⏱ 30m')).toBeInTheDocument();
        expect(screen.getByText('#maker')).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({
            header: 'Order filament', duration: '00:30:00', tag_ids: ['tag-maker'], parent_id: 'hw',
            priority: 7, // inherited from Hardware Design
        });
        await waitFor(() => expect(input).toHaveValue(''));
        expect(input).toHaveFocus();
        expect(await screen.findByText(/Added “Order filament” to T250 › Hardware Design/)).toBeInTheDocument();
    });

    it('inherits the parent tags when none are typed', async () => {
        const input = renderQuickAdd();
        await type(input, 'Test prints');
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0].tag_ids).toEqual(['tag-maker']);
        expect(posted[0].duration).toBeUndefined(); // unestimated → default duration
    });

    it('makes the task top-level when the project chip is removed', async () => {
        const input = renderQuickAdd();
        await type(input, 'Buy milk');
        fireEvent.click(screen.getByRole('button', { name: /no project for this task/i }));
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ header: 'Buy milk', parent_id: null });
        expect(posted[0].priority).toBeUndefined();
    });

    it('uses a typed +project instead of the active one', async () => {
        const input = renderQuickAdd();
        await type(input, 'Draft outline +blog');
        expect(screen.getByTestId('quick-add-project')).toHaveTextContent('Company Blog');
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(posted[0]).toMatchObject({ parent_id: 'blog' }));
    });

    it('does not save while an error chip is shown', async () => {
        const input = renderQuickAdd();
        await type(input, 'Order filament >32.1.');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByText(/not a valid date/)).toBeInTheDocument();
        expect(posted).toEqual([]);
    });

    it('asks for a name when only tokens were typed', async () => {
        const input = renderQuickAdd();
        await type(input, '30m #maker');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByText(/type a name for the task/i)).toBeInTheDocument();
        expect(posted).toEqual([]);
    });

    it('creates new tags on save', async () => {
        const input = renderQuickAdd();
        await type(input, 'Plant beans #garden');
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(tagPosts).toEqual(['garden']);
        expect(posted[0].tag_ids).toEqual(['tag-garden']);
    });

    it('warns when the project runs over budget and can raise the estimate', async () => {
        parentAfterSave = { over_budget: true, parts_total: '13:00:00', duration: '12:00:00' };
        const input = renderQuickAdd();
        await type(input, 'Assembly 10h');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByText(/T250 › Hardware Design is now 1h over budget/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /raise estimate/i }));
        await waitFor(() => expect(patched).toEqual([{
            id: 'hw', body: { duration: '13:00:00', estimate_reason: 'raised_from_warning' },
        }]));
    });

    it('Ctrl+Enter saves and opens the new task for details', async () => {
        const onOpenTask = vi.fn();
        const input = renderQuickAdd(onOpenTask);
        await type(input, 'Write report');
        fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
        await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('new-task'));
    });

    it('does not save before the active project is loaded', async () => {
        server.use(http.get(`${API}/settings/`, () => new Promise(() => {}))); // never answers
        const input = renderQuickAdd();
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Too early' } });
        expect(screen.getByTestId('quick-add-project')).toHaveTextContent('Loading…');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByText(/still loading/i)).toBeInTheDocument();
        expect(posted).toEqual([]);
    });

    it('Escape clears the input', async () => {
        const input = renderQuickAdd();
        await type(input, 'Something');
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input).toHaveValue('');
    });
});
