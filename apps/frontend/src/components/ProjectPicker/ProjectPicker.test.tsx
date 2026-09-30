import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPicker } from './ProjectPicker.tsx';
import type { ProjectOption } from '../../utils/projects.ts';

const projects: ProjectOption[] = [
    { id: 't250', header: 'T250', path: 'T250', depth: 0, color: null },
    { id: 'hw', header: 'Hardware Design', path: 'T250 › Hardware Design', depth: 1, color: null },
    { id: 'blog', header: 'Company Blog', path: 'Company Blog', depth: 0, color: null },
];

function renderPicker(props: Partial<Parameters<typeof ProjectPicker>[0]> = {}) {
    const onPick = vi.fn();
    render(<ProjectPicker open anchorEl={document.body} onClose={vi.fn()} onPick={onPick}
        projects={projects} noneLabel="Top level" {...props} />);
    return { onPick, input: screen.getByRole('combobox') };
}

describe('ProjectPicker', () => {
    afterEach(cleanup);

    it('lists "none" first and the projects as a tree', () => {
        renderPicker();
        expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Top level', 'T250', 'Hardware Design', 'Company Blog']);
    });

    it('filters by path and picks with Enter', () => {
        const { onPick, input } = renderPicker();
        fireEvent.change(input, { target: { value: 'hard' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onPick).toHaveBeenCalledWith({ kind: 'project', id: 'hw' });
    });

    it('offers to create a project only when allowed', () => {
        const { input } = renderPicker();
        fireEvent.change(input, { target: { value: 'Garden' } });
        expect(screen.queryByRole('option', { name: /new project/i })).toBeNull();
        cleanup();
        const second = renderPicker({ allowCreate: true });
        fireEvent.change(second.input, { target: { value: 'Garden' } });
        fireEvent.click(screen.getByRole('option', { name: /new project “Garden”/i }));
        expect(second.onPick).toHaveBeenCalledWith({ kind: 'create', name: 'Garden' });
    });

    it('lists recent projects first with their path', () => {
        renderPicker({ recentIds: ['hw'] });
        expect(screen.getAllByRole('option')[1]).toHaveTextContent('T250 › Hardware Design');
    });

    it('puts an exact name match first, even before a recent project', () => {
        // "T250" also matches the recent "T250 › Hardware Design" by path.
        const { onPick, input } = renderPicker({ recentIds: ['hw'] });
        fireEvent.change(input, { target: { value: 't250' } });
        expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['T250', 'T250 › Hardware Design']);
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onPick).toHaveBeenCalledWith({ kind: 'project', id: 't250' });
    });

    it('ranks names starting with the text before other path matches', () => {
        const { input } = renderPicker({ recentIds: ['blog'] });
        fireEvent.change(input, { target: { value: 'co' } });
        // Nothing starts with "co" except "Company Blog"; order otherwise unchanged.
        expect(screen.getAllByRole('option')[0]).toHaveTextContent('Company Blog');
        fireEvent.change(input, { target: { value: 'de' } });
        expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['T250 › Hardware Design']);
    });
});

