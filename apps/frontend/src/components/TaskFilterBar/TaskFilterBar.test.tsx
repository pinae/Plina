import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TaskFilterBar } from './TaskFilterBar.tsx';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';
import { savedFilterHandlers } from '../../testing/savedFilterHandlers.ts';
import { makerTag } from '../../testing/treeFixtures.ts';
import type { SavedFilter } from '../../types.ts';
import { ACTIVE_PROJECT, EMPTY_FILTER, type TaskFilter } from '../../utils/taskFilter.ts';

const store: SavedFilter[] = [];
const server = setupServer(...savedFilterHandlers(store));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { store.splice(0); });
afterAll(() => server.close());

const projects = [
    { id: 't250', header: 'T250', path: 'T250', depth: 0, color: '#e91e63' },
    { id: 'hw', header: 'Hardware Design', path: 'T250 › Hardware Design', depth: 1, color: '#e91e63' },
];

function Live({ onChange, initial }: { onChange?: (filter: TaskFilter) => void; initial: TaskFilter }) {
    const [filter, setFilter] = useState(initial);
    return (
        <TaskFilterBar filter={filter} onChange={next => { setFilter(next); onChange?.(next); }}
            projects={projects} tags={[makerTag]} matchCount={3} totalCount={9} />
    );
}

function Bar({ onChange, initial = EMPTY_FILTER }: { onChange?: (filter: TaskFilter) => void; initial?: TaskFilter }) {
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return <QueryClientProvider client={client}><Live onChange={onChange} initial={initial} /></QueryClientProvider>;
}

const deepWork: TaskFilter = { ...EMPTY_FILTER, tags: [makerTag.id], priority: [7, 10] };

describe('TaskFilterBar', () => {
    it('chooses projects, the active one included, and clears one filter', () => {
        const onChange = vi.fn();
        render(<Bar onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const choices = screen.getByRole('dialog', { name: 'Project' });
        fireEvent.click(within(choices).getByRole('checkbox', { name: 'Hardware Design' }));
        fireEvent.click(within(choices).getByRole('checkbox', { name: 'Active project' }));
        expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, projects: ['hw', ACTIVE_PROJECT] });
        expect(screen.getByRole('button', { name: 'Project: Hardware Design +1', hidden: true })).toBeInTheDocument();
        expect(screen.getByText('3 of 9 tasks')).toBeInTheDocument();

        fireEvent.click(within(choices).getByRole('button', { name: 'Clear project' }));
        expect(onChange).toHaveBeenLastCalledWith(EMPTY_FILTER);
    });

    it('narrows the priority range from either end', () => {
        const onChange = vi.fn();
        render(<Bar onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
        const lowest = screen.getByRole('slider', { name: 'lowest priority' });
        fireEvent.keyDown(lowest, { key: 'ArrowRight' });
        expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, priority: [1, 10] });
        expect(screen.getByRole('button', { name: 'Priority: !1–10', hidden: true })).toBeInTheDocument();
    });

    it('clears everything at once', () => {
        const onChange = vi.fn();
        render(<Bar onChange={onChange} />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'cad' } });
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(onChange).toHaveBeenLastCalledWith(EMPTY_FILTER);
        expect(screen.queryByText('3 of 9 tasks')).toBeNull();
    });
});

describe('saved filters (README: Filtering tasks)', () => {
    const savedMenu = async () => {
        fireEvent.click(screen.getByRole('button', { name: /^(Saved|Deep work|Focus)$/ }));
        return screen.findByRole('menu', { name: 'Saved filters' });
    };

    it('saves the current filter under a name, and the button then shows it', async () => {
        render(<Bar initial={deepWork} />);
        const menu = await savedMenu();
        expect(within(menu).getByText('No saved filters yet. Set a filter, then save it here.')).toBeInTheDocument();
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Save current filter…' }));
        const dialog = await screen.findByRole('dialog', { name: 'Save filter' });
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Deep work' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save filter' })).toBeNull());
        expect(store).toEqual([expect.objectContaining({ name: 'Deep work', filter: deepWork })]);
        expect(await screen.findByRole('button', { name: 'Deep work' })).toBeInTheDocument();
    });

    it('applies a saved filter from the menu', async () => {
        store.push({ id: 's1', name: 'Deep work', filter: deepWork, created_at: '' });
        const onChange = vi.fn();
        render(<Bar onChange={onChange} />);
        const menu = await savedMenu();
        fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Deep work' }));
        expect(onChange).toHaveBeenLastCalledWith(deepWork);
        expect(await screen.findByRole('button', { name: 'Deep work' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tag: #maker', hidden: true })).toBeInTheDocument();
    });

    it('replaces a saved filter saved again under its name', async () => {
        store.push({ id: 's1', name: 'Deep work', filter: deepWork, created_at: '' });
        render(<Bar initial={{ ...deepWork, priority: [8, 10] }} />);
        const menu = await savedMenu();
        await within(menu).findByRole('menuitem', { name: 'Deep work' });
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Save current filter…' }));
        const dialog = await screen.findByRole('dialog', { name: 'Save filter' });
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'deep work' } });
        expect(within(dialog).getByText('Replaces the saved filter “Deep work”.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Replace “Deep work”' }));
        await waitFor(() => expect(store[0].filter.priority).toEqual([8, 10]));
        expect(store).toHaveLength(1);
    });

    it('deletes a saved filter after asking', async () => {
        store.push({ id: 's1', name: 'Deep work', filter: deepWork, created_at: '' });
        render(<Bar />);
        const menu = await savedMenu();
        fireEvent.click(await within(menu).findByRole('button', { name: 'delete Deep work' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete “Deep work”?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(store).toEqual([]));
    });

    it('on phones: saved filters lead the sheet', async () => {
        store.push({ id: 's1', name: 'Deep work', filter: deepWork, created_at: '' });
        const restore = fakeScreen(PHONE);
        try {
            const onChange = vi.fn();
            render(<Bar onChange={onChange} />);
            fireEvent.click(screen.getByRole('button', { name: 'filters' }));
            const section = await screen.findByRole('region', { name: 'Saved filters' });
            expect(within(section).getByRole('button', { name: 'Save current filter' })).toBeDisabled(); // nothing on
            fireEvent.click(await within(section).findByRole('button', { name: 'Deep work' }));
            expect(onChange).toHaveBeenLastCalledWith(deepWork);
            await waitFor(() => expect(within(section).getByRole('button', { name: 'Deep work' }))
                .toHaveAttribute('aria-pressed', 'true'));
        } finally {
            restore();
        }
    });
});
