import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickAddSuggestions, type QuickAddSuggestionsProps } from './QuickAddSuggestions.tsx';

afterEach(cleanup);

const props = (over: Partial<QuickAddSuggestionsProps> = {}): QuickAddSuggestionsProps => ({
    projects: [{ id: 'hw', label: 'Hardware Design' }, { id: 'blog', label: 'Company Blog' }],
    parentId: 'hw',
    onParent: vi.fn(),
    tags: [{ id: 'tag-maker', name: 'maker', hex_color: '#000' }, { id: 'tag-errand', name: 'errand', hex_color: '#000' }],
    tagIds: ['tag-maker'],
    onToggleTag: vi.fn(),
    minutes: 30,
    onMinutes: vi.fn(),
    ...over,
});

const pressed = (name: string | RegExp) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('QuickAddSuggestions', () => {
    it('shows projects, tags and durations as toggle chips with their state', () => {
        render(<QuickAddSuggestions {...props()} />);
        expect(pressed('Hardware Design')).toBe('true');
        expect(pressed('Company Blog')).toBe('false');
        expect(pressed('No project')).toBe('false');
        expect(pressed('#maker')).toBe('true');
        expect(pressed('#errand')).toBe('false');
        expect(pressed('30m')).toBe('true');
        expect(pressed('1h')).toBe('false');
    });

    it('reports taps', () => {
        const p = props();
        render(<QuickAddSuggestions {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Company Blog' }));
        expect(p.onParent).toHaveBeenCalledWith('blog');
        fireEvent.click(screen.getByRole('button', { name: 'No project' }));
        expect(p.onParent).toHaveBeenCalledWith(null);
        fireEvent.click(screen.getByRole('button', { name: '#errand' }));
        expect(p.onToggleTag).toHaveBeenCalledWith('tag-errand');
        fireEvent.click(screen.getByRole('button', { name: '2h' }));
        expect(p.onMinutes).toHaveBeenCalledWith(120);
    });

    it('tapping the chosen duration again clears it (back to the default)', () => {
        const p = props();
        render(<QuickAddSuggestions {...p} />);
        fireEvent.click(screen.getByRole('button', { name: '30m' }));
        expect(p.onMinutes).toHaveBeenCalledWith(null);
    });

    it('marks "No project" when the task will be top level', () => {
        render(<QuickAddSuggestions {...props({ parentId: null })} />);
        expect(pressed('No project')).toBe('true');
    });

    it('does not steal the focus from the input (keeps the phone keyboard open)', () => {
        render(<QuickAddSuggestions {...props()} />);
        // The whole panel prevents the focus change; pressing a chip itself
        // would start its ripple animation outside the test's act().
        // fireEvent returns false when a handler called preventDefault().
        expect(fireEvent.mouseDown(screen.getByText('Estimate'))).toBe(false);
    });
});
