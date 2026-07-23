import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { PlanMyWeekButton } from './PlanMyWeekButton.tsx';

describe('PlanMyWeekButton', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.useRealTimers(); cleanup(); });

    const setup = (props: Partial<React.ComponentProps<typeof PlanMyWeekButton>> = {}) => {
        const onTrigger = vi.fn();
        const onClick = vi.fn();
        const utils = render(
            <PlanMyWeekButton dirty={false} dragging={false} onTrigger={onTrigger} onClick={onClick} {...props} />,
        );
        return { onTrigger, onClick, ...utils };
    };

    it('fires the plan event 5s after becoming dirty (drag finished)', () => {
        const { onTrigger, rerender } = setup();
        expect(onTrigger).not.toHaveBeenCalled();

        rerender(<PlanMyWeekButton dirty dragging={false} onTrigger={onTrigger} onClick={vi.fn()} />);
        expect(screen.getByTestId('replan-countdown')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(5000); });
        expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('does not count down while a drag is in progress', () => {
        const onTrigger = vi.fn();
        const { rerender } = render(
            <PlanMyWeekButton dirty dragging onTrigger={onTrigger} onClick={vi.fn()} />,
        );
        expect(screen.queryByTestId('replan-countdown')).toBeNull();
        act(() => { vi.advanceTimersByTime(6000); });
        expect(onTrigger).not.toHaveBeenCalled();

        // Once the drag ends the countdown starts.
        rerender(<PlanMyWeekButton dirty dragging={false} onTrigger={onTrigger} onClick={vi.fn()} />);
        act(() => { vi.advanceTimersByTime(5000); });
        expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('resets the countdown when a new drag starts before it elapses', () => {
        const onTrigger = vi.fn();
        const props = { dirty: true, onTrigger, onClick: vi.fn() };
        const { rerender } = render(<PlanMyWeekButton dragging={false} {...props} />);

        act(() => { vi.advanceTimersByTime(3000); }); // partway
        rerender(<PlanMyWeekButton dragging {...props} />); // new drag postpones
        act(() => { vi.advanceTimersByTime(5000); });
        expect(onTrigger).not.toHaveBeenCalled(); // postponed

        rerender(<PlanMyWeekButton dragging={false} {...props} />); // drag ends -> restart
        act(() => { vi.advanceTimersByTime(5000); });
        expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('triggers immediately on click', () => {
        const { onClick } = setup({ dirty: true });
        fireEvent.click(screen.getByRole('button', { name: /plan my week/i }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
