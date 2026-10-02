import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WeekView } from './WeekView.tsx';
import type { ViewTask } from '../WeekViewTask/WeekViewTask.tsx';

// Mock DayColumn to simplify WeekView tests and avoid deep rendering issues
vi.mock('../DayColumn/DayColumn', () => ({
    BUCKET_COLUMN_WIDTH: 42,
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
        vi.unstubAllGlobals();
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

    it('renders a floating drag card at the target day for a move', () => {
        render(<WeekView
            {...defaultProps}
            activeDrag={{
                taskId: 't1', mode: 'move', start: new Date('2024-02-14T10:00:00'),
                durationMinutes: 60, color: '#3357ff', title: 'Meeting',
                isAppointment: true, cursorHalf: 'left',
            }}
        />);
        expect(screen.getByTestId('drag-layer')).toHaveTextContent('Meeting');
    });

    it('shows no floating card for a resize', () => {
        render(<WeekView
            {...defaultProps}
            activeDrag={{
                taskId: 't1', mode: 'resize-bottom', start: new Date('2024-02-14T10:00:00'),
                durationMinutes: 60, color: '#3357ff', title: 'Task',
                isAppointment: false, cursorHalf: 'left',
            }}
        />);
        expect(screen.queryByTestId('drag-layer')).toBeNull();
    });

    it('zooms in with the mouse wheel and never shrinks below the fit height', () => {
        render(<WeekView {...defaultProps} />);
        const height = () => Number(screen.getByTestId('week-grid').getAttribute('data-column-height'));
        const fit = height();

        fireEvent.wheel(screen.getByTestId('week-scroll'), { deltaY: -100 });
        expect(height()).toBeGreaterThan(fit);

        // Zooming back out is clamped at the fit height (zoom >= 1).
        fireEvent.wheel(screen.getByTestId('week-scroll'), { deltaY: 100 });
        fireEvent.wheel(screen.getByTestId('week-scroll'), { deltaY: 100 });
        expect(height()).toBe(fit);
    });

    it('keeps the time under the cursor in place from the first zoom step on (regression)', () => {
        // Regression: the new scroll position was set in an animation frame
        // that could run before React rendered the taller grid, so the browser
        // clamped it to the old (unscrollable) height and the view jumped.
        // Here the frame runs at once, which makes that order deterministic.
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
        render(<WeekView {...defaultProps} />);
        const scroll = screen.getByTestId('week-scroll');
        const grid = screen.getByTestId('week-grid');
        const HEADER = 70;
        Object.defineProperty(screen.getByTestId('time-scale-corner').parentElement!, 'offsetHeight', {
            configurable: true, get: () => HEADER,
        });
        const columnHeight = () => Number(grid.getAttribute('data-column-height'));
        const viewport = columnHeight(); // zoom 1: the day fills the area below the headers
        // Like a browser, clamp scrollTop to the content that exists right now.
        let top = 0;
        Object.defineProperty(scroll, 'scrollTop', {
            configurable: true,
            get: () => top,
            set: (value: number) => { top = Math.max(0, Math.min(value, columnHeight() - viewport)); },
        });
        const pointerY = HEADER + viewport * 0.75; // the scroll area starts at clientY 0 in jsdom
        const timeUnderCursor = () => ((top + pointerY - HEADER) / columnHeight()) * 1440;
        const before = timeUnderCursor();

        for (let step = 1; step <= 4; step++) {
            fireEvent.wheel(scroll, { deltaY: -100, clientY: pointerY });
            // Column heights are rounded to whole pixels: allow 1 px (2 min).
            expect(Math.abs(timeUnderCursor() - before), `after step ${step}`).toBeLessThan(2);
        }
    });

    it('shows a time scale left of Monday whose labels get denser when zoomed in', () => {
        render(<WeekView {...defaultProps} />);
        const scale = screen.getByTestId('time-scale');
        const grid = screen.getByTestId('week-grid');
        expect(scale.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const count = () => within(scale).getAllByTestId('time-scale-label').length;
        const before = count();

        for (let i = 0; i < 6; i++) fireEvent.wheel(screen.getByTestId('week-scroll'), { deltaY: -100 });
        expect(count()).toBeGreaterThan(before);
    });

    it('scrolls the day headers sideways together with the grid and the time scale', () => {
        render(<WeekView {...defaultProps} />);
        const scroll = screen.getByTestId('week-scroll');
        expect(within(scroll).getByText('12')).toBeInTheDocument(); // Monday's date
        expect(within(scroll).getByTestId('time-scale-corner')).toBeInTheDocument();
    });
});
