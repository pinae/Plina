/**
 * UI-7 acceptance (docs/task-entry-ui.md §5, §10): the outline against a
 * stateful fake backend that recomputes Σ parts / Rest like the real one.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OutlineView } from './OutlineView.tsx';
import { API, makeTask, makerTag, settingsFor } from '../../testing/treeFixtures.ts';
import { minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import type { Task, TaskWrite } from '../../types.ts';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';

let tasks: Task[] = [];
let activeId: string | null = 'hw';
let log: string[] = [];
let autoCompleted: { id: string; header: string }[] = [];

/** Derive the tree fields like the backend does. */
function withTree(list: Task[]): Task[] {
    const byId = new Map(list.map(t => [t.id, t]));
    const ancestors = (t: Task): string[] => (t.parent_id ? [...ancestors(byId.get(t.parent_id)!), t.parent_id] : []);
    return list.map(t => {
        const children = list.filter(c => c.parent_id === t.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const estimate = parseDurationMinutes(t.duration) ?? 60;
        const parts = children.reduce((sum, c) => sum + (parseDurationMinutes(c.duration) ?? 60), 0);
        return {
            ...t, children_ids: children.map(c => c.id), ancestor_ids: ancestors(t),
            is_estimated: t.duration !== null,
            parts_total: children.length ? minutesToDurationString(parts) : null,
            rest: children.length ? minutesToDurationString(Math.max(0, estimate - parts)) : null,
            over_budget: children.length > 0 && parts > estimate,
        };
    });
}

const initialTasks = (): Task[] => [
    makeTask('t250', { header: 'T250', order: 0, duration: '20:00:00', hex_color: '#e91e63' }),
    makeTask('hw', { header: 'Hardware Design', parent_id: 't250', order: 0, duration: '12:00:00', tags: [makerTag] }),
    makeTask('cad', { header: 'CAD', parent_id: 'hw', order: 0, duration: '03:00:00' }),
    makeTask('prints', { header: 'test prints', parent_id: 'hw', order: 1, duration: '02:00:00' }),
    makeTask('fw', { header: 'Firmware', parent_id: 't250', order: 1, duration: '04:00:00' }),
    makeTask('blog', { header: 'Company Blog', order: 1, duration: '09:00:00' }),
    makeTask('article', { header: 'Write article', parent_id: 'blog', order: 0, duration: null }),
    makeTask('milk', { header: 'Buy milk', order: 2, duration: null }),
];

const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json(withTree(tasks))),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settingsFor(withTree(tasks), activeId))),
    http.get(`${API}/plan/`, () => HttpResponse.json({ accepted_plan_id: null, warnings: [], appointments: [], buckets: [] })),
    http.patch(`${API}/tasks/:id/`, async ({ params, request }) => {
        const body = await request.json() as TaskWrite;
        log.push(`PATCH ${params.id} ${JSON.stringify(body)}`);
        tasks = tasks.map(t => (t.id === params.id ? {
            ...t, ...body,
            ...(body.parent_id !== undefined && body.order === undefined
                ? { order: tasks.filter(s => s.parent_id === body.parent_id).length } : {}),
            tags: body.tag_ids ? body.tag_ids.map(id => (id === makerTag.id ? makerTag : { id, name: id, hex_color: null })) : t.tags,
        } as Task : t));
        return HttpResponse.json(withTree(tasks).find(t => t.id === params.id));
    }),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = await request.json() as TaskWrite;
        log.push(`POST ${JSON.stringify(body)}`);
        const task = makeTask(`new-${tasks.length}`, { header: body.header, parent_id: body.parent_id ?? null,
            duration: body.duration ?? null, order: 99 });
        tasks = [...tasks, task];
        return HttpResponse.json(task, { status: 201 });
    }),
    http.post(`${API}/tasks/:id/track/start/`, ({ params }) => {
        log.push(`start ${params.id}`);
        return HttpResponse.json({ task: tasks.find(t => t.id === params.id), stopped_task_id: null });
    }),
    http.post(`${API}/tasks/:id/complete/`, ({ params }) => {
        log.push(`complete ${params.id}`);
        tasks = tasks.map(t => (t.id === params.id ? { ...t, is_done: true, completed_at: new Date().toISOString() } : t));
        return HttpResponse.json({ task: tasks.find(t => t.id === params.id), alternatives: [], auto_completed: autoCompleted });
    }),
    http.post(`${API}/tasks/:id/reopen/`, ({ params }) => {
        log.push(`reopen ${params.id}`);
        tasks = tasks.map(t => (t.id === params.id ? { ...t, is_done: false, completed_at: null } : t));
        return HttpResponse.json({ task: tasks.find(t => t.id === params.id), reopened: [params.id] });
    }),
    http.delete(`${API}/tasks/:id/`, ({ params }) => {
        log.push(`DELETE ${params.id}`);
        tasks = tasks.filter(t => t.id !== params.id);
        return new HttpResponse(null, { status: 204 });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
    tasks = initialTasks();
    activeId = 'hw';
    log = [];
    autoCompleted = [];
    localStorage.clear();
});
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

function renderOutline(deleteDelayMs = 50) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><OutlineView deleteDelayMs={deleteDelayMs} /></QueryClientProvider>);
}

const outline = () => screen.getByRole('tree', { name: /outline/i });
const rowNames = () => within(outline()).queryAllByRole('treeitem').map(r => r.getAttribute('aria-label'));
const row = (name: string) => within(outline()).getByRole('treeitem', { name });
const press = (key: string, extra: Record<string, unknown> = {}) => fireEvent.keyDown(outline(), { key, ...extra });
const select = async (name: string) => {
    fireEvent.click(await within(outline()).findByRole('treeitem', { name }));
    expect(row(name)).toHaveAttribute('aria-selected', 'true');
};

describe('one tree (T-3)', () => {
    it('shows every project, the active project\'s top-level task first, the active node marked', async () => {
        activeId = 'article';
        renderOutline();
        await waitFor(() => expect(rowNames()).toEqual([
            'Company Blog', 'Write article', 'Rest of Company Blog',
            'T250', 'Hardware Design', 'CAD', 'test prints', 'Rest of Hardware Design', 'Firmware', 'Rest of T250',
            'Buy milk',
        ]));
        expect(row('Write article')).toHaveAttribute('data-active', 'true');
        expect(row('Hardware Design')).not.toHaveAttribute('data-active');
    });

    it('has no project filter any more', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'Buy milk' });
        expect(screen.queryByRole('button', { name: /all projects/i })).toBeNull();
    });

    it('remembers collapsed rows per browser', async () => {
        renderOutline();
        fireEvent.click(await within(outline()).findByRole('button', { name: 'collapse Company Blog' }));
        await waitFor(() => expect(rowNames()).not.toContain('Write article'));
        cleanup();
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'Company Blog' });
        expect(rowNames()).not.toContain('Write article');
    });

    it('opens the path to the active project even if it was collapsed', async () => {
        localStorage.setItem('plina.collapsedTasks', JSON.stringify(['t250', 'blog']));
        renderOutline();
        expect(await within(outline()).findByRole('treeitem', { name: 'Hardware Design' })).toHaveAttribute('data-active', 'true');
        expect(rowNames()).not.toContain('Write article'); // other collapsed rows stay collapsed
    });

    it('"Show completed" lists completed tasks greyed in their place; remembered', async () => {
        tasks = [...tasks, makeTask('parts', { header: 'Order parts', parent_id: 'hw', order: 2,
            is_done: true, completed_at: '2026-09-29T10:00:00Z' })];
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'CAD' });
        expect(rowNames()).not.toContain('Order parts');
        fireEvent.click(screen.getByRole('switch', { name: /show completed/i }));
        expect(row('Order parts')).toHaveAttribute('data-done', 'true');
        expect(localStorage.getItem('plina.showCompleted')).toBe('true');
        // Its circle reopens it.
        fireEvent.click(within(row('Order parts')).getByRole('checkbox', { name: 'reopen Order parts' }));
        await waitFor(() => expect(log).toContain('reopen parts'));
    });

    it('the circle completes a task, with Undo (Todoist/Wunderlist)', async () => {
        renderOutline();
        fireEvent.click(within(await within(outline()).findByRole('treeitem', { name: 'CAD' }))
            .getByRole('checkbox', { name: 'complete CAD' }));
        await waitFor(() => expect(log).toContain('complete cad'));
        expect(await screen.findByText('Completed “CAD”')).toBeInTheDocument();
        await waitFor(() => expect(rowNames()).not.toContain('CAD'));
        fireEvent.click(screen.getByRole('button', { name: /undo/i }));
        await waitFor(() => expect(log).toContain('reopen cad'));
        await waitFor(() => expect(rowNames()).toContain('CAD'));
    });

    it('names parents that completed along', async () => {
        autoCompleted = [{ id: 'blog', header: 'Company Blog' }];
        renderOutline();
        fireEvent.click(within(await within(outline()).findByRole('treeitem', { name: 'Write article' }))
            .getByRole('checkbox', { name: 'complete Write article' }));
        expect(await screen.findByText('Completed “Write article” — “Company Blog” completed too')).toBeInTheDocument();
    });

    it('a parent with open subtasks cannot be ticked — it completes with its last one', async () => {
        renderOutline();
        const box = within(await within(outline()).findByRole('treeitem', { name: 'Hardware Design' }))
            .getByRole('checkbox', { name: 'complete Hardware Design' });
        expect(box).toBeDisabled();
    });

    it('"+ Add task" at the end of a project adds to that project (Todoist)', async () => {
        renderOutline();
        fireEvent.click(await screen.findByRole('button', { name: 'add task to T250' }));
        const input = await screen.findByRole('textbox', { name: /new task/i });
        fireEvent.change(input, { target: { value: 'Order screws 30m' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(log.some(l => l.startsWith('POST'))).toBe(true));
        expect(JSON.parse(log.find(l => l.startsWith('POST'))!.slice(5))).toMatchObject({
            header: 'Order screws', parent_id: 't250', duration: '00:30:00',
        });
    });

    it('"+ Add task" at the end of the tree adds a new project', async () => {
        renderOutline();
        fireEvent.click(await screen.findByRole('button', { name: 'add task at the top level' }));
        const input = await screen.findByRole('textbox', { name: /new task/i });
        fireEvent.change(input, { target: { value: 'Garden shed' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(log.some(l => l.startsWith('POST'))).toBe(true));
        expect(JSON.parse(log.find(l => l.startsWith('POST'))!.slice(5))).toMatchObject({ header: 'Garden shed', parent_id: null });
    });

    it('marks overdue deadlines', async () => {
        tasks = tasks.map(t => (t.id === 'cad' ? { ...t, latest_finish_date: '2020-01-01T12:00:00Z' }
            : t.id === 'fw' ? { ...t, latest_finish_date: '2099-01-01T12:00:00Z' } : t));
        renderOutline();
        const cad = await within(outline()).findByRole('treeitem', { name: 'CAD' });
        expect(within(cad).getByTestId('deadline')).toHaveAttribute('data-overdue', 'true');
        expect(within(row('Firmware')).getByTestId('deadline')).not.toHaveAttribute('data-overdue');
    });

    it('keeps the keyboard help in a "?" tooltip', async () => {
        renderOutline();
        expect(await screen.findByRole('button', { name: /keyboard shortcuts/i })).toBeInTheDocument();
        expect(screen.queryByText(/Tab \/ Shift\+Tab indent/)).toBeNull();
    });
});

describe('re-parenting', () => {
    it('Tab makes the previous sibling the parent, whose Σ/Rest then updates', async () => {
        renderOutline();
        await select('Firmware');
        expect(within(row('Hardware Design')).getByTestId('estimate')).toHaveTextContent('Σ 5h / 12h');

        press('Tab');

        await waitFor(() => expect(log).toContain('PATCH fw {"parent_id":"hw"}'));
        await waitFor(() => expect(within(row('Hardware Design')).getByTestId('estimate')).toHaveTextContent('Σ 9h / 12h'));
        expect(row('Rest of Hardware Design')).toHaveTextContent('3h');
    });

    it('Shift+Tab moves a row one level up', async () => {
        renderOutline();
        await select('CAD');
        press('Tab', { shiftKey: true });
        await waitFor(() => expect(log).toContain('PATCH cad {"parent_id":"t250"}'));
    });

    it('Alt+↓ reorders siblings', async () => {
        renderOutline();
        await select('CAD');
        press('ArrowDown', { altKey: true });
        await waitFor(() => expect(log).toEqual([
            'PATCH prints {"order":0}', 'PATCH cad {"order":1}',
        ]));
    });

    it('M moves a row with the project picker', async () => {
        renderOutline();
        await select('CAD');
        press('m');
        const picker = await screen.findByRole('combobox');
        fireEvent.change(picker, { target: { value: 'Blog' } });
        fireEvent.keyDown(picker, { key: 'Enter' });
        await waitFor(() => expect(log).toContain('PATCH cad {"parent_id":"blog"}'));
    });
});

describe('editing rows', () => {
    it('digits set the priority', async () => {
        renderOutline();
        await select('CAD');
        press('8');
        await waitFor(() => expect(log).toContain('PATCH cad {"priority":8}'));
    });

    it('Enter edits the header inline; tokens set estimate and tags', async () => {
        renderOutline();
        await select('test prints');
        press('Enter');
        const input = await screen.findByRole('textbox', { name: /edit header/i });
        fireEvent.change(input, { target: { value: 'Test prints 2:30 #maker' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(log.some(l => l.startsWith('PATCH prints'))).toBe(true));
        const patch = JSON.parse(log.find(l => l.startsWith('PATCH prints'))!.slice('PATCH prints '.length));
        expect(patch).toMatchObject({ header: 'Test prints', duration: '02:30:00', tag_ids: ['tag-maker'] });
    });

    it('Enter on the last row of a level adds a new sibling', async () => {
        renderOutline();
        await select('test prints');
        press('Enter');
        fireEvent.keyDown(await screen.findByRole('textbox', { name: /edit header/i }), { key: 'Enter' });
        const draft = await screen.findByRole('textbox', { name: /new task/i });
        fireEvent.change(draft, { target: { value: 'assembly 2h' } });
        fireEvent.keyDown(draft, { key: 'Enter' });
        await waitFor(() => expect(log.some(l => l.startsWith('POST'))).toBe(true));
        expect(JSON.parse(log.find(l => l.startsWith('POST'))!.slice(5))).toMatchObject({
            header: 'assembly', parent_id: 'hw', duration: '02:00:00',
            tag_ids: ['tag-maker'], // inherited from Hardware Design, like quick add
        });
    });

    it('▶ and Space start tracking; a Rest row tracks its parent', async () => {
        renderOutline();
        fireEvent.click(await within(outline()).findByRole('button', { name: 'start tracking CAD' }));
        await waitFor(() => expect(log).toContain('start cad'));
        await select('Rest of Hardware Design');
        press(' ');
        await waitFor(() => expect(log).toContain('start hw'));
    });

    it('S opens the split editor', async () => {
        renderOutline();
        await select('Hardware Design');
        press('s');
        expect(await screen.findByText('Split “Hardware Design”')).toBeInTheDocument();
    });

    it('Del hides the row with an undo; the delete happens only after the delay', async () => {
        renderOutline(10_000);
        await select('CAD');
        press('Delete');
        await waitFor(() => expect(rowNames()).not.toContain('CAD'));
        fireEvent.click(screen.getByRole('button', { name: /undo/i }));
        await waitFor(() => expect(rowNames()).toContain('CAD'));
        expect(log.filter(l => l.startsWith('DELETE'))).toEqual([]);
    });

    it('Del really deletes when not undone', async () => {
        renderOutline(20);
        await select('CAD');
        press('Delete');
        await waitFor(() => expect(log).toContain('DELETE cad'));
    });
});

describe('sorting session', () => {
    it('lists the inbox and removes a row once it has an estimate', async () => {
        renderOutline();
        fireEvent.click(await screen.findByRole('button', { name: /sort/i }));
        // Sorted by project path: top-level tasks (no path) first.
        await waitFor(() => expect(rowNames()).toEqual(['Buy milk', 'Write article']));
        expect(row('Buy milk')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Inbox (2)')).toBeInTheDocument();

        press('e');
        const input = await screen.findByRole('textbox', { name: /edit estimate/i });
        fireEvent.change(input, { target: { value: '45m' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(rowNames()).toEqual(['Write article']));
        expect(log).toContain('PATCH milk {"duration":"00:45:00"}');
        expect(row('Write article')).toHaveAttribute('aria-selected', 'true'); // the next row
    });

    it('Enter opens the full edit dialog', async () => {
        renderOutline();
        fireEvent.click(await screen.findByRole('button', { name: /sort/i }));
        await waitFor(() => expect(rowNames()).toContain('Buy milk'));
        act(() => outline().focus());
        press('Enter');
        expect(await screen.findByText('Edit “Buy milk”')).toBeInTheDocument();
    });
});

describe('touch screens (UI-9)', () => {
    let restore: () => void;
    beforeEach(() => { restore = fakeScreen(PHONE); });
    afterEach(() => restore());

    const tools = (name: string) => within(outline()).getByRole('toolbar', { name });

    it('the selected row gets buttons instead of Tab / Alt+↑↓ / Enter', async () => {
        renderOutline();
        await select('test prints');
        expect(within(outline()).getAllByRole('toolbar')).toHaveLength(1);
        const bar = tools('test prints');

        fireEvent.click(within(bar).getByRole('button', { name: 'indent' }));
        await waitFor(() => expect(log).toContain('PATCH prints {"parent_id":"cad"}'));
    });

    it('outdent and move by buttons', async () => {
        renderOutline();
        await select('CAD');
        fireEvent.click(within(tools('CAD')).getByRole('button', { name: 'move down' }));
        await waitFor(() => expect(log).toEqual(['PATCH prints {"order":0}', 'PATCH cad {"order":1}']));
        log = [];
        fireEvent.click(within(tools('CAD')).getByRole('button', { name: 'outdent' }));
        await waitFor(() => expect(log).toContain('PATCH cad {"parent_id":"t250"}'));
    });

    it('disables what is impossible for the row', async () => {
        renderOutline();
        await select('CAD'); // first child of Hardware Design
        const bar = tools('CAD');
        expect(within(bar).getByRole('button', { name: 'indent' })).toBeDisabled();
        expect(within(bar).getByRole('button', { name: 'move up' })).toBeDisabled();
        expect(within(bar).getByRole('button', { name: 'outdent' })).toBeEnabled();
    });

    it('"Details" opens the edit dialog — there is no double-click on a phone', async () => {
        renderOutline();
        await select('CAD');
        fireEvent.click(within(tools('CAD')).getByRole('button', { name: 'details' }));
        expect(await screen.findByRole('dialog')).toHaveTextContent('Edit “CAD”');
    });

    it('has no keyboard help', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'CAD' });
        expect(screen.queryByRole('button', { name: /keyboard shortcuts/i })).toBeNull();
    });
});

