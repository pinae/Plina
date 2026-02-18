import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WeekView } from './WeekView';
import type { ViewTask } from './WeekViewTask';

// Mock DayColumn to simplify WeekView tests and avoid deep rendering issues
vi.mock('./DayColumn', () => ({
    DayColumn: () => (
        <div data-testid="day-column">
            DayColumn
        </div>
    )
}));

describe('WeekView', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    const defaultProps = {
        tasks: [] as ViewTask[],
        // optional: initialDate for deterministic testing
        initialDate: new Date('2024-02-16T12:00:00'), // Friday
    };

    it('renders 7 day columns', () => {
        render(<WeekView {...defaultProps} />);
        const columns = screen.getAllByTestId('day-column');
        expect(columns).toHaveLength(7);
    });

    it('renders the correct date range in header', () => {
        // Feb 16 2024 is a Friday. Week should be Mon 12.02 - Sun 18.02.
        render(<WeekView {...defaultProps} />);
        // Expect "12.2. - 18.2.2024"
        expect(screen.getByText(/12\.2\./)).toBeInTheDocument();
        expect(screen.getByText(/18\.2\./)).toBeInTheDocument();
        expect(screen.getByText(/2024/)).toBeInTheDocument();
    });

    it('navigates to next week', () => {
        render(<WeekView {...defaultProps} />);
        const nextButton = screen.getByText('>');
        fireEvent.click(nextButton);

        // Next week: Mon 19.02 - Sun 25.02
        expect(screen.getByText(/19\.2\./)).toBeInTheDocument();
        expect(screen.getByText(/25\.2\./)).toBeInTheDocument();
    });

    it('navigates to previous week', () => {
        render(<WeekView {...defaultProps} />);
        const prevButton = screen.getByText('<');
        fireEvent.click(prevButton);

        // Prev week: Mon 05.02 - Sun 11.02
        expect(screen.getByText(/5\.2\./)).toBeInTheDocument(); // 5.2.
        expect(screen.getByText(/11\.2\./)).toBeInTheDocument();
    });

    it('calculates correct start of week from a Wednesday', () => {
        render(<WeekView {...defaultProps} initialDate={new Date('2024-02-14T12:00:00')} />);
        // Should still be 12.2 - 18.2
        expect(screen.getByText(/12\.2\./)).toBeInTheDocument();
    });

    it('calculates correct start of week from a Sunday', () => {
        // Sun 18.02 should belong to the week ending on 18.02 if we use ISO weeks (Mon-Sun)
        render(<WeekView {...defaultProps} initialDate={new Date('2024-02-18T12:00:00')} />);
        expect(screen.getByText(/12\.2\./)).toBeInTheDocument();
        expect(screen.getByText(/18\.2\./)).toBeInTheDocument();
    });
});
