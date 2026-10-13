import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrioritySlider } from './PrioritySlider.tsx';

afterEach(cleanup);

/** jsdom has no layout: give the slider a 100 px wide track at x = 0. */
function layOut(root: HTMLElement) {
    root.getBoundingClientRect = () => ({
        width: 100, height: 10, left: 0, right: 100, top: 0, bottom: 10, x: 0, y: 0, toJSON: () => ({}),
    });
}

/** Hover: the light display becomes the real slider. */
function hover() {
    fireEvent.pointerEnter(screen.getByTestId('priority-slider'));
    return screen.getByTestId('priority-slider').querySelector<HTMLElement>('.MuiSlider-root')!;
}

describe('PrioritySlider', () => {
    it('shows the priority and its band', () => {
        render(<PrioritySlider value={7} label="CAD" onCommit={vi.fn()} />);
        const slider = screen.getByRole('slider', { name: 'priority of CAD' });
        expect(slider).toHaveAttribute('aria-valuenow', '7');
        expect(screen.getByTestId('priority-slider')).toHaveAttribute('data-band', 'high');
    });

    it('a drag commits once, on release (5 → 8)', () => {
        const onCommit = vi.fn();
        render(<PrioritySlider value={5} label="CAD" onCommit={onCommit} />);
        const root = hover();
        layOut(root);
        fireEvent.mouseDown(root, { clientX: 50, buttons: 1 });
        fireEvent.mouseMove(document, { clientX: 65, buttons: 1 });
        fireEvent.mouseMove(document, { clientX: 80, buttons: 1 });
        expect(onCommit).not.toHaveBeenCalled();
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '8'); // follows the drag
        fireEvent.mouseUp(document, { clientX: 80 });
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(8);
    });

    it('keeps showing the committed value until the new value arrives; follows a rollback', () => {
        const { rerender } = render(<PrioritySlider value={5} label="CAD" onCommit={vi.fn()} />);
        const root = hover();
        layOut(root);
        fireEvent.mouseDown(root, { clientX: 80, buttons: 1 });
        fireEvent.mouseUp(document, { clientX: 80 });
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '8'); // value prop still 5
        rerender(<PrioritySlider value={8} label="CAD" onCommit={vi.fn()} />); // optimistic update
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '8');
        rerender(<PrioritySlider value={5} label="CAD" onCommit={vi.fn()} />); // refused: rolled back
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '5');
    });

    it('a click on the track sets that value', () => {
        const onCommit = vi.fn();
        render(<PrioritySlider value={5} label="CAD" onCommit={onCommit} />);
        const root = hover();
        layOut(root);
        fireEvent.mouseDown(root, { clientX: 20, buttons: 1 });
        fireEvent.mouseUp(document, { clientX: 20 });
        expect(onCommit).toHaveBeenCalledWith(2);
    });

    it('arrow keys step by one', () => {
        const onCommit = vi.fn();
        render(<PrioritySlider value={5} label="CAD" onCommit={onCommit} />);
        hover();
        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
        expect(onCommit).toHaveBeenCalledWith(6);
    });

    it('does not commit an unchanged value', () => {
        const onCommit = vi.fn();
        render(<PrioritySlider value={5} label="CAD" onCommit={onCommit} />);
        const root = hover();
        layOut(root);
        fireEvent.mouseDown(root, { clientX: 50, buttons: 1 });
        fireEvent.mouseUp(document, { clientX: 50 });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('keeps its clicks to itself (the row behind opens a dialog on click)', () => {
        const onRowClick = vi.fn();
        render(<div onClick={onRowClick}><PrioritySlider value={5} label="CAD" onCommit={vi.fn()} /></div>);
        fireEvent.click(screen.getByTestId('priority-slider'));
        expect(onRowClick).not.toHaveBeenCalled();
    });

    describe('light until used (README: Performance)', () => {
        it('shows the value as a light display, no MUI slider, until hovered', () => {
            render(<PrioritySlider value={7} label="CAD" onCommit={vi.fn()} />);
            const display = screen.getByRole('slider', { name: 'priority of CAD' });
            expect(display).toHaveAttribute('aria-valuenow', '7');
            expect(screen.getByTestId('priority-slider').querySelector('.MuiSlider-root')).toBeNull();

            hover();
            expect(screen.getByTestId('priority-slider').querySelector('.MuiSlider-root')).not.toBeNull();
            fireEvent.pointerLeave(screen.getByTestId('priority-slider'));
            expect(screen.getByTestId('priority-slider').querySelector('.MuiSlider-root')).toBeNull();
            expect(screen.getByRole('slider', { name: 'priority of CAD' })).toHaveAttribute('aria-valuenow', '7');
        });

        it('focus (Tab) brings the real slider, with the focus in it: arrow keys work', () => {
            const onCommit = vi.fn();
            render(<PrioritySlider value={5} label="CAD" onCommit={onCommit} />);
            act(() => screen.getByRole('slider', { name: 'priority of CAD' }).focus());

            const input = screen.getByTestId('priority-slider').querySelector('input')!;
            expect(input).toHaveFocus();
            fireEvent.keyDown(input, { key: 'ArrowRight' });
            expect(onCommit).toHaveBeenCalledWith(6);
        });

        it('a press on the display (touch, no hover) sets the value there at once', () => {
            const onCommit = vi.fn();
            render(<PrioritySlider value={5} label="CAD" onCommit={onCommit} />);
            const display = screen.getByRole('slider', { name: 'priority of CAD' });
            layOut(display);
            // jsdom's PointerEvent has no coordinates: a MouseEvent of that type.
            fireEvent(display, new MouseEvent('pointerdown', { bubbles: true, clientX: 30 }));
            expect(onCommit).toHaveBeenCalledWith(3);
        });
    });

    it('compact (phones): a coloured "!7" chip opens the slider in a popover', () => {
        const onCommit = vi.fn();
        render(<PrioritySlider compact value={7} label="CAD" onCommit={onCommit} />);
        expect(screen.queryByRole('slider')).toBeNull();
        const chip = screen.getByRole('button', { name: 'priority of CAD: 7' });
        expect(chip).toHaveAttribute('data-band', 'high');
        fireEvent.click(chip);
        const popover = screen.getByRole('presentation');
        fireEvent.keyDown(within(popover).getByRole('slider', { name: 'priority of CAD' }), { key: 'ArrowLeft' });
        expect(onCommit).toHaveBeenCalledWith(6);
    });
});
