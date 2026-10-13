/**
 * Typing and moving through the Tasks tab re-render only what changes: the
 * text of an input stays in the input, and a row renders again only when
 * its own props change (README: Performance).
 *
 * Every open task row renders one PrioritySlider; a stub counts them, so
 * each count is one row rendered.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutlineView } from './OutlineView.tsx';
import { QuickAdd } from '../QuickAdd/QuickAdd.tsx';
import { API, makeTask, makerTag, settingsFor } from '../../testing/treeFixtures.ts';
import type { Task } from '../../types.ts';
import { calendarHandlers } from '../../testing/calendarHandlers.ts';
import { savedFilterHandlers } from '../../testing/savedFilterHandlers.ts';

const renders: string[] = [];
vi.mock('../PrioritySlider/PrioritySlider.tsx', () => ({
    PrioritySlider: ({ label }: { label: string }) => {
        renders.push(label);
        return <span data-testid="priority-slider" />;
    },
}));

/** A project with 20 tasks, a second one with 10, and a single task. */
const tasks: Task[] = [
    makeTask('p1', { header: 'Project One', order: 0, children_ids: Array.from({ length: 20 }, (_, i) => `a${i}`) }),
    ...Array.from({ length: 20 }, (_, i) => makeTask(`a${i}`, {
        header: `Alpha ${i}`, parent_id: 'p1', ancestor_ids: ['p1'], order: i, duration: '01:00:00',
    })),
    makeTask('p2', { header: 'Project Two', order: 1, children_ids: Array.from({ length: 10 }, (_, i) => `b${i}`) }),
    ...Array.from({ length: 10 }, (_, i) => makeTask(`b${i}`, {
        header: `Beta ${i}`, parent_id: 'p2', ancestor_ids: ['p2'], order: i, duration: '00:30:00',
    })),
    makeTask('solo', { header: 'Solo', order: 2, duration: '00:15:00' }),
];

const server = setupServer(
    ...calendarHandlers(),
    ...savedFilterHandlers(),
    http.get(`${API}/tasks/`, () => HttpResponse.json(tasks)),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settingsFor(tasks, null))),
    http.get(`${API}/plan/`, () => HttpResponse.json({ accepted_plan_id: null, warnings: [], appointments: [], buckets: [] })),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

async function renderTasksTab() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <QuickAdd />
            <OutlineView />
        </QueryClientProvider>,
    );
    await screen.findByRole('treeitem', { name: 'Solo' });
}

const outline = () => screen.getByRole('tree', { name: /outline/i });
/** Rows rendered by ``action`` (labels in render order). */
function rendersDuring(action: () => void): string[] {
    renders.length = 0;
    action();
    return [...renders];
}
const typeInto = (input: HTMLElement, text: string) => {
    for (let i = 1; i <= text.length; i++) fireEvent.change(input, { target: { value: text.slice(0, i) } });
};

describe('re-rendering in the Tasks tab (README: Performance)', () => {
    it('typing a new task renders no row', async () => {
        await renderTasksTab();
        fireEvent.click(screen.getByRole('button', { name: 'add task to Project Two' }));
        const input = await screen.findByRole('textbox', { name: 'New task' });

        expect(rendersDuring(() => typeInto(input, 'Order filament 30m #maker !7'))).toEqual([]);
        expect(input).toHaveValue('Order filament 30m #maker !7');
    });

    it('typing in an inline edit renders no row, not even the edited one', async () => {
        await renderTasksTab();
        act(() => outline().focus());
        fireEvent.keyDown(outline(), { key: 'ArrowDown' }); // Project One
        fireEvent.keyDown(outline(), { key: 'ArrowDown' }); // Alpha 0
        fireEvent.keyDown(outline(), { key: '#' }); // edit the header, a tag begun
        const input = await screen.findByRole('textbox', { name: 'Edit header of Alpha 0' });

        expect(rendersDuring(() => typeInto(input, 'Alpha 0 #maker 2h'))).toEqual([]);
        expect(input).toHaveValue('Alpha 0 #maker 2h');
    });

    it('typing in the quick add (parsed on every keystroke) renders no row', async () => {
        await renderTasksTab();
        const input = screen.getByLabelText('Add task');
        act(() => input.focus());

        expect(rendersDuring(() => typeInto(input, 'Order filament 30m #maker !7 >fri'))).toEqual([]);
        expect(await screen.findByText('⏱ 30m')).toBeInTheDocument(); // the parse shows as chips
    });

    it('moving the selection renders only the two rows it leaves and reaches', async () => {
        await renderTasksTab();
        act(() => outline().focus());
        fireEvent.keyDown(outline(), { key: 'ArrowDown' });
        fireEvent.keyDown(outline(), { key: 'ArrowDown' }); // Alpha 0

        const step = rendersDuring(() => fireEvent.keyDown(outline(), { key: 'ArrowDown' }));
        expect([...step].sort()).toEqual(['Alpha 0', 'Alpha 1']);
        expect(within(outline()).getByRole('treeitem', { name: 'Alpha 1' })).toHaveAttribute('aria-selected', 'true');
    });
});
