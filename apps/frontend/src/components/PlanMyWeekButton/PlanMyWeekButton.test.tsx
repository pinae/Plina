import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { PlanMyWeekButton } from './PlanMyWeekButton.tsx';

describe('PlanMyWeekButton', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.useRealTimers(); cleanup(); });

    it('plans on a click only — never by itself (README: Planning light)', () => {
        const onClick = vi.fn();
        render(<PlanMyWeekButton onClick={onClick} />);
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(onClick).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /plan my week/i }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('is an icon button with the same name on phones (UI-9)', () => {
        const onClick = vi.fn();
        render(<PlanMyWeekButton compact onClick={onClick} />);
        const button = screen.getByRole('button', { name: /plan my week/i });
        expect(button).not.toHaveTextContent(/plan my week/i);
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
