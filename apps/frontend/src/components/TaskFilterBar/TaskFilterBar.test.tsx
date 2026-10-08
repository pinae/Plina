import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TaskFilterBar } from './TaskFilterBar.tsx';
import { makerTag } from '../../testing/treeFixtures.ts';
import { ACTIVE_PROJECT, EMPTY_FILTER, type TaskFilter } from '../../utils/taskFilter.ts';

const projects = [
    { id: 't250', header: 'T250', path: 'T250', depth: 0, color: '#e91e63' },
    { id: 'hw', header: 'Hardware Design', path: 'T250 › Hardware Design', depth: 1, color: '#e91e63' },
];

function Bar({ onChange }: { onChange?: (filter: TaskFilter) => void }) {
    const [filter, setFilter] = useState(EMPTY_FILTER);
    return (
        <TaskFilterBar filter={filter} onChange={next => { setFilter(next); onChange?.(next); }}
            projects={projects} tags={[makerTag]} matchCount={3} totalCount={9} />
    );
}

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
