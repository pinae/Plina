import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskColorPicker } from './TaskColorPicker.tsx';

const pressed = (name: string | RegExp) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('TaskColorPicker (§4.4)', () => {
    it('offers "From parent" for a subtask, showing the parent\'s color', () => {
        render(<TaskColorPicker value={null} inheritedColor="#477ed8" topLevel={false} onChange={() => { }} />);
        expect(pressed(/from parent/i)).toBe('true');
        expect(screen.getByTestId('inherited-swatch')).toHaveStyle({ backgroundColor: '#477ed8' });
        expect(screen.getByText(/same as its parent/i)).toBeInTheDocument();
    });

    it('offers "Automatic" for a project', () => {
        render(<TaskColorPicker value={null} inheritedColor="#9f7100" topLevel onChange={() => { }} />);
        expect(pressed(/automatic/i)).toBe('true');
        expect(screen.getByText(/unlike the other projects/i)).toBeInTheDocument();
    });

    it('says a new project gets its automatic color when saved', () => {
        render(<TaskColorPicker value={null} inheritedColor={null} topLevel onChange={() => { }} />);
        expect(screen.getByText(/picked when you save/i)).toBeInTheDocument();
    });

    it('chooses a swatch, and goes back to the inherited color', () => {
        const onChange = vi.fn();
        const { rerender } = render(<TaskColorPicker value={null} inheritedColor="#477ed8" topLevel={false} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Green' }));
        expect(onChange).toHaveBeenLastCalledWith('#25984d');

        rerender(<TaskColorPicker value="#25984d" inheritedColor="#477ed8" topLevel={false} onChange={onChange} />);
        expect(pressed('Green')).toBe('true');
        expect(pressed(/from parent/i)).toBe('false');
        fireEvent.click(screen.getByRole('button', { name: /from parent/i }));
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it('takes any custom color from the browser\'s picker', () => {
        const onChange = vi.fn();
        const { rerender } = render(<TaskColorPicker value={null} inheritedColor="#477ed8" topLevel={false} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText(/custom color/i), { target: { value: '#123456' } });
        expect(onChange).toHaveBeenLastCalledWith('#123456');

        rerender(<TaskColorPicker value="#123456" inheritedColor="#477ed8" topLevel={false} onChange={onChange} />);
        expect(screen.getByTestId('custom-swatch')).toHaveStyle({ backgroundColor: '#123456' });
        for (const name of ['Red', 'Blue', /from parent/i]) expect(pressed(name)).toBe('false');
    });
});
