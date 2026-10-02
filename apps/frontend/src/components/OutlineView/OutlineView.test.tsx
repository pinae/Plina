/**
 * UI-7 acceptance (docs/task-entry-ui.md §5, §10): the outline against a
 * stateful fake backend that recomputes Σ parts / Rest like the real one.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutlineView } from './OutlineView.tsx';
import { API, makeTask, makerTag, settingsFor } from '../../testing/treeFixtures.ts';
import { minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import type { Task, TaskWrite } from '../../types.ts';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';
import { applyMove } from '../../utils/treeDnd.ts';

let tasks: Task[] = [];
let activeId: string | null = 'hw';
let log: string[] = [];
let autoCompleted: { id: string; header: string }[] = [];

/** Derive the tree fields like the backend does. */
function withTree(list: Task[]): Task[] {
    const byId = new Map(list.map(t => [t.id, t]));
    const ancestors = (t: Task): string[] => (t.parent_id ? [...ancestors(byId.get(t.parent_id)!), t.parent_id] : []);
    // §4.4: its own color, else the parent's; a project's hex_color is its automatic one.
    const shown = (t: Task): string | null =>
        t.own_hex_color ?? (t.parent_id ? shown(byId.get(t.parent_id)!) : t.hex_color);
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
            hex_color: shown(t),
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
    http.post(`${API}/tasks/:id/move/`, async ({ params, request }) => {
        const { parent_id: parentId, index } = await request.json() as { parent_id: string | null; index: number };
        log.push(`move ${params.id} ${parentId} ${index}`);
        tasks = applyMove(tasks, String(params.id), parentId, index);
        return HttpResponse.json({ task: withTree(tasks).find(t => t.id === params.id) });
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
/** Select a row from the keyboard (a click opens the edit dialog, T-4). */
const select = async (name: string) => {
    await within(outline()).findByRole('treeitem', { name });
    act(() => outline().focus());
    const target = rowNames().indexOf(name);
    const current = within(outline()).queryAllByRole('treeitem').findIndex(r => r.getAttribute('aria-selected') === 'true');
    for (let i = current; i < target; i++) press('ArrowDown');
    for (let i = current; i > target; i--) press('ArrowUp');
    expect(row(name)).toHaveAttribute('aria-selected', 'true');
};

describe('task colors (§4.4)', () => {
    const dot = (name: string) => within(row(name)).getByTestId('task-color-dot');

    it('shows a dot in the color each row shows: own, else inherited from the parent', async () => {
        tasks = tasks.map(t => (t.id === 'fw' ? { ...t, own_hex_color: '#25984d' } : t));
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'CAD' });
        expect(dot('T250')).toHaveStyle({ backgroundColor: '#e91e63' });
        expect(dot('Hardware Design')).toHaveStyle({ backgroundColor: '#e91e63' });
        expect(dot('CAD')).toHaveStyle({ backgroundColor: '#e91e63' });
        expect(dot('Firmware')).toHaveStyle({ backgroundColor: '#25984d' });
        // A Rest is planned as its parent and shows the parent's color.
        expect(dot('Rest of Hardware Design')).toHaveStyle({ backgroundColor: '#e91e63' });
    });
});

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

describe('the edit dialog in the tree (T-4)', () => {
    it('a click on a row opens its edit dialog and selects it', async () => {
        renderOutline();
        fireEvent.click(await within(outline()).findByRole('treeitem', { name: 'CAD' }));
        expect(await screen.findByRole('dialog')).toHaveTextContent('Edit “CAD”');
        // The tree behind the modal is hidden from assistive tech meanwhile.
        expect(screen.getByRole('treeitem', { name: 'CAD', hidden: true })).toHaveAttribute('aria-selected', 'true');
    });

    it('Enter opens the selected row; closing returns to it, so ↓ Enter opens the next', async () => {
        renderOutline();
        await select('CAD');
        press('Enter');
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(outline()).toHaveFocus();
        expect(row('CAD')).toHaveAttribute('aria-selected', 'true');
        press('ArrowDown');
        press('Enter');
        expect(await screen.findByRole('dialog')).toHaveTextContent('Edit “test prints”');
    });

    it('↑/↓ in the dialog walk the tree, skipping Rest rows; the selection follows', async () => {
        renderOutline();
        fireEvent.click(await within(outline()).findByRole('treeitem', { name: 'test prints' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /next task/i }));
        // "Rest of Hardware Design" comes next in the tree but is not a task.
        await waitFor(() => expect(dialog).toHaveTextContent('Edit “Firmware”'));
        fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(row('Firmware')).toHaveAttribute('aria-selected', 'true');
    });

    it('the first task has no previous one', async () => {
        renderOutline();
        fireEvent.click(await within(outline()).findByRole('treeitem', { name: 'T250' }));
        expect(within(await screen.findByRole('dialog')).getByRole('button', { name: /previous task/i })).toBeDisabled();
    });

    it('a Rest row opens the split editor', async () => {
        renderOutline();
        fireEvent.click(await within(outline()).findByRole('treeitem', { name: 'Rest of Hardware Design' }));
        expect(await screen.findByText('Split “Hardware Design”')).toBeInTheDocument();
    });
});

describe('re-parenting', () => {
    it('Tab makes the previous sibling the parent, whose Σ/Rest then updates', async () => {
        renderOutline();
        await select('Firmware');
        expect(within(row('Hardware Design')).getByTestId('estimate')).toHaveTextContent('Σ 5h / 12h');

        press('Tab');

        await waitFor(() => expect(log).toEqual(['move fw hw 2']));
        await waitFor(() => expect(within(row('Hardware Design')).getByTestId('estimate')).toHaveTextContent('Σ 9h / 12h'));
        expect(row('Rest of Hardware Design')).toHaveTextContent('3h');
    });

    it('Shift+Tab moves a row one level up', async () => {
        renderOutline();
        await select('CAD');
        press('Tab', { shiftKey: true });
        await waitFor(() => expect(log).toEqual(['move cad t250 1'])); // right after its old parent
    });

    it('Alt+↓ reorders siblings', async () => {
        renderOutline();
        await select('CAD');
        press('ArrowDown', { altKey: true });
        await waitFor(() => expect(log).toEqual(['move cad hw 1'])); // one request (T-6)
    });

    it('M moves a row with the project picker', async () => {
        renderOutline();
        await select('CAD');
        press('m');
        const picker = await screen.findByRole('combobox');
        fireEvent.change(picker, { target: { value: 'Blog' } });
        fireEvent.keyDown(picker, { key: 'Enter' });
        await waitFor(() => expect(log).toEqual(['move cad blog 1'])); // appended
    });
});

describe('moves: Undo and refusals (T-6)', () => {
    it('a move offers Undo, which puts the task back', async () => {
        renderOutline();
        await select('Firmware');
        press('Tab');
        expect(await screen.findByText('Moved “Firmware” into “Hardware Design”')).toBeInTheDocument();
        await waitFor(() => expect(row('Firmware')).toHaveAttribute('aria-level', '3'));
        fireEvent.click(screen.getByRole('button', { name: /undo/i }));
        await waitFor(() => expect(log).toEqual(['move fw hw 2', 'move fw t250 1']));
        await waitFor(() => expect(row('Firmware')).toHaveAttribute('aria-level', '2'));
    });

    it('names the top level and plain reorders', async () => {
        renderOutline();
        await select('Write article');
        press('Tab', { shiftKey: true });
        expect(await screen.findByText('Moved “Write article” to the top level')).toBeInTheDocument();
        await select('CAD');
        press('ArrowDown', { altKey: true });
        expect(await screen.findByText('Moved “CAD”')).toBeInTheDocument();
    });

    it('shows the move at once and rolls back with the server\'s reason', async () => {
        server.use(http.post(`${API}/tasks/:id/move/`, () => HttpResponse.json(
            { parent_id: ['Moving “Firmware” into “Hardware Design” would create a dependency cycle.'] }, { status: 400 })));
        renderOutline();
        await select('Firmware');
        press('Tab');
        expect(await screen.findByText(/would create a dependency cycle/)).toBeInTheDocument();
        await waitFor(() => expect(row('Firmware')).toHaveAttribute('aria-level', '2'));
    });
});

describe('editing rows', () => {
    it('digits set the priority', async () => {
        renderOutline();
        await select('CAD');
        press('8');
        await waitFor(() => expect(log).toContain('PATCH cad {"priority":8}'));
    });

    it('# edits the header inline; tokens set estimate and tags', async () => {
        renderOutline();
        await select('test prints');
        press('#');
        const input = await screen.findByRole('textbox', { name: /edit header/i });
        fireEvent.change(input, { target: { value: 'Test prints 2:30 #maker' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(log.some(l => l.startsWith('PATCH prints'))).toBe(true));
        const patch = JSON.parse(log.find(l => l.startsWith('PATCH prints'))!.slice('PATCH prints '.length));
        expect(patch).toMatchObject({ header: 'Test prints', duration: '02:30:00', tag_ids: ['tag-maker'] });
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
        await waitFor(() => expect(log).toEqual(['move prints cad 0']));
    });

    it('outdent and move by buttons', async () => {
        renderOutline();
        await select('CAD');
        fireEvent.click(within(tools('CAD')).getByRole('button', { name: 'move down' }));
        await waitFor(() => expect(log).toEqual(['move cad hw 1']));
        log = [];
        fireEvent.click(within(tools('CAD')).getByRole('button', { name: 'outdent' }));
        await waitFor(() => expect(log).toEqual(['move cad t250 1']));
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

    it('marks the active project by its name, without the "active" label that crowds it out (T-7)', async () => {
        renderOutline();
        const hw = await within(outline()).findByRole('treeitem', { name: 'Hardware Design' });
        expect(hw).toHaveAttribute('data-active', 'true');
        expect(within(hw).queryByText('active')).toBeNull();
        expect(within(hw).getByText('Hardware Design')).toHaveAttribute('data-active-name', 'true');
    });

    it('has no keyboard help', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'CAD' });
        expect(screen.queryByRole('button', { name: /keyboard shortcuts/i })).toBeNull();
    });
});

describe('priority slider (T-5)', () => {
    const sliderRoot = (name: string) => {
        const root = within(row(name)).getByTestId('priority-slider').querySelector<HTMLElement>('.MuiSlider-root')!;
        root.getBoundingClientRect = () => ({
            width: 100, height: 10, left: 0, right: 100, top: 0, bottom: 10, x: 0, y: 0, toJSON: () => ({}),
        });
        return root;
    };
    const drag = (root: HTMLElement, from: number, to: number) => {
        fireEvent.mouseDown(root, { clientX: from, buttons: 1 });
        fireEvent.mouseMove(document, { clientX: (from + to) / 2, buttons: 1 });
        fireEvent.mouseMove(document, { clientX: to, buttons: 1 });
        fireEvent.mouseUp(document, { clientX: to });
    };

    it('a drag from 5 to 8 sends exactly one change and shows it at once', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'CAD' });
        drag(sliderRoot('CAD'), 50, 80);
        expect(within(row('CAD')).getByRole('slider')).toHaveAttribute('aria-valuenow', '8');
        await waitFor(() => expect(log.filter(l => l.startsWith('PATCH cad'))).toEqual(['PATCH cad {"priority":8}']));
        expect(screen.queryByRole('dialog')).toBeNull(); // the row did not open
    });

    it('rolls back with the server\'s message when the change is refused', async () => {
        server.use(http.patch(`${API}/tasks/:id/`, () =>
            HttpResponse.json({ priority: ['Priority must be between 0 and 10.'] }, { status: 400 })));
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'CAD' });
        drag(sliderRoot('CAD'), 50, 90);
        expect(await screen.findByText('Priority must be between 0 and 10.')).toBeInTheDocument();
        await waitFor(() => expect(within(row('CAD')).getByRole('slider')).toHaveAttribute('aria-valuenow', '5'));
    });

    it('phones show a coloured chip that opens the slider', async () => {
        const restore = fakeScreen(PHONE);
        try {
            renderOutline();
            const cad = await within(outline()).findByRole('treeitem', { name: 'CAD' });
            expect(within(cad).queryByRole('slider')).toBeNull();
            expect(within(cad).getByRole('button', { name: 'priority of CAD: 5' })).toBeInTheDocument();
        } finally {
            restore();
        }
    });
});

describe('drag and drop (T-6)', () => {
    const ROW = 32;
    beforeAll(() => {
        // jsdom has no PointerEvent; dnd-kit's pointer sensor needs one.
        if (!('PointerEvent' in window)) {
            class PointerEventPolyfill extends MouseEvent {
                pointerId: number;
                isPrimary: boolean;
                constructor(type: string, init: PointerEventInit = {}) {
                    super(type, init);
                    this.pointerId = init.pointerId ?? 1;
                    this.isPrimary = init.isPrimary ?? true;
                }
            }
            (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
        }
    });
    beforeEach(() => {
        // jsdom has no layout: stack the rows 32 px apart, 800 px wide.
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            const row = this.closest('[role="treeitem"]');
            const rows = [...document.querySelectorAll('[role="treeitem"]')];
            const top = row ? rows.indexOf(row) * ROW : 0;
            return { top, bottom: top + ROW, left: 0, right: 800, width: 800, height: row ? ROW : 0,
                x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        });
    });
    afterEach(() => vi.restoreAllMocks());

    const handle = (name: string) => within(row(name)).getByRole('button', { name: `drag ${name}` });
    const startDrag = (name: string) => {
        const y = rowNames().indexOf(name) * ROW + ROW / 2;
        fireEvent.pointerDown(handle(name), { clientX: 10, clientY: y, button: 0, isPrimary: true });
        return y;
    };
    const moveTo = (x: number, y: number) => fireEvent.pointerMove(document, { clientX: x, clientY: y });
    const drop = (x: number, y: number) => fireEvent.pointerUp(document, { clientX: x, clientY: y });
    const dragBy = (name: string, dx: number, rows: number) => {
        const y = startDrag(name);
        moveTo(10 + dx / 2, y + (rows * ROW) / 2);
        moveTo(10 + dx, y + rows * ROW);
        drop(10 + dx, y + rows * ROW);
    };

    it('dragging right by one indent makes it a subtask', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'Firmware' });
        dragBy('Firmware', 24, 0);
        await waitFor(() => expect(log).toEqual(['move fw hw 2']));
        expect(await screen.findByText('Moved “Firmware” into “Hardware Design”')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull(); // grabbing the handle opens nothing
    });

    it('dragging down one row reorders', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'CAD' });
        dragBy('CAD', 0, 1);
        await waitFor(() => expect(log).toEqual(['move cad hw 1']));
    });

    it('a parent that loses its last subtask stays open (docs/tasks-tab.md §2)', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'Write article' });
        dragBy('Write article', -24, 0);
        await waitFor(() => expect(log).toEqual(['move article null 2']));
        await waitFor(() => expect(row('Write article')).toHaveAttribute('aria-level', '1'));
        expect(row('Company Blog')).not.toHaveAttribute('data-done');
        expect(within(row('Company Blog')).queryByRole('button', { name: /collapse/i })).toBeNull();
        expect(log.some(l => l.startsWith('complete'))).toBe(false);
    });

    it('the subtree travels along: hidden while its parent is dragged', async () => {
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'Hardware Design' });
        const y = startDrag('Hardware Design');
        moveTo(10, y + 10);
        await waitFor(() => expect(row('Hardware Design')).toHaveAttribute('data-dragging', 'true'));
        expect(rowNames()).not.toContain('CAD');
        drop(10, y + 10);
        await waitFor(() => expect(rowNames()).toContain('CAD'));
        expect(log).toEqual([]); // dropped where it was
    });

    it('hovering a collapsed parent while dragging opens it', async () => {
        localStorage.setItem('plina.collapsedTasks', JSON.stringify(['hw']));
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'Firmware' });
        expect(rowNames()).not.toContain('CAD');
        const y = startDrag('Firmware');
        moveTo(10, y - ROW / 2); // half a row up, towards Hardware Design
        moveTo(10, y - ROW);
        await waitFor(() => expect(rowNames()).toContain('CAD'), { timeout: 2000 });
        drop(10, y - ROW);
    });

    it('Rest rows and completed tasks cannot be dragged', async () => {
        tasks = [...tasks, makeTask('parts', { header: 'Order parts', parent_id: 'hw', order: 2,
            is_done: true, completed_at: '2026-09-29T10:00:00Z' })];
        localStorage.setItem('plina.showCompleted', 'true');
        renderOutline();
        await within(outline()).findByRole('treeitem', { name: 'Order parts' });
        expect(within(row('Rest of Hardware Design')).queryByRole('button', { name: /^drag/ })).toBeNull();
        expect(within(row('Order parts')).queryByRole('button', { name: /^drag/ })).toBeNull();
        expect(within(row('CAD')).getByRole('button', { name: 'drag CAD' })).toBeInTheDocument();
    });
});

