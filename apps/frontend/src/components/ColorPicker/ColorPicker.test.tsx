import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColorPicker } from './ColorPicker.tsx';

const pressed = (name: string | RegExp) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('ColorPicker (§4.4)', () => {
    it('offers "From parent" for a subtask, showing the parent\'s color', () => {
        render(<ColorPicker value={null} defaultColor="#477ed8" automatic={false} onChange={() => { }} />);
        expect(pressed(/from parent/i)).toBe('true');
        expect(screen.getByTestId('default-swatch')).toHaveStyle({ backgroundColor: '#477ed8' });
        expect(screen.getByText(/same as its parent/i)).toBeInTheDocument();
    });

    it('offers "Automatic" for a project', () => {
        render(<ColorPicker value={null} defaultColor="#9f7100" automatic onChange={() => { }} />);
        expect(pressed(/automatic/i)).toBe('true');
        expect(screen.getByText(/unlike the other projects/i)).toBeInTheDocument();
    });

    it('says a new project gets its automatic color when saved', () => {
        render(<ColorPicker value={null} defaultColor={null} automatic onChange={() => { }} />);
        expect(screen.getByText(/picked when you save/i)).toBeInTheDocument();
    });

    it('speaks of time buckets in a bucket form', () => {
        const { rerender } = render(
            <ColorPicker value={null} defaultColor="#af8e2a" automatic others="time buckets"
                chosenHint="Every bucket of this type shows it." onChange={() => { }} />);
        expect(screen.getByText(/unlike the other time buckets/i)).toBeInTheDocument();
        rerender(<ColorPicker value="#25984d" defaultColor="#af8e2a" automatic others="time buckets"
            chosenHint="Every bucket of this type shows it." onChange={() => { }} />);
        expect(screen.getByText('Every bucket of this type shows it.')).toBeInTheDocument();
    });

    it('chooses a swatch, and goes back to the default color', () => {
        const onChange = vi.fn();
        const { rerender } = render(<ColorPicker value={null} defaultColor="#477ed8" automatic={false} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Green' }));
        expect(onChange).toHaveBeenLastCalledWith('#25984d');

        rerender(<ColorPicker value="#25984d" defaultColor="#477ed8" automatic={false} onChange={onChange} />);
        expect(pressed('Green')).toBe('true');
        expect(pressed(/from parent/i)).toBe('false');
        expect(screen.getByText(/subtasks without a color of their own/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /from parent/i }));
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it('takes any custom color from the browser\'s picker', () => {
        const onChange = vi.fn();
        const { rerender } = render(<ColorPicker value={null} defaultColor="#477ed8" automatic={false} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText(/custom color/i), { target: { value: '#123456' } });
        expect(onChange).toHaveBeenLastCalledWith('#123456');

        rerender(<ColorPicker value="#123456" defaultColor="#477ed8" automatic={false} onChange={onChange} />);
        expect(screen.getByTestId('custom-swatch')).toHaveStyle({ backgroundColor: '#123456' });
        for (const name of ['Red', 'Blue', /from parent/i]) expect(pressed(name)).toBe('false');
    });
});
