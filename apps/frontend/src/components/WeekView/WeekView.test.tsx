import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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

    describe('opening on the usual work hours (settings)', () => {
        // Like a browser, clamp scrollTop to the content that exists right now
        // (the fit height is the 720 px fallback in jsdom), so a scroll set
        // before the grid has its new height would be lost.
        const tops = new WeakMap<Element, number>();
        beforeEach(() => {
            Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
                configurable: true,
                get() { return tops.get(this) ?? 0; },
                set(value: number) {
                    const grid = (this as HTMLElement).querySelector('[data-testid="week-grid"]');
                    const height = grid ? Number(grid.getAttribute('data-column-height')) : 0;
                    tops.set(this, Math.max(0, Math.min(value, height - 720)));
                },
            });
        });
        afterEach(() => { delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop; });

        const height = () => Number(screen.getByTestId('week-grid').getAttribute('data-column-height'));
        const scrollTop = () => screen.getByTestId('week-scroll').scrollTop;
        // The frame starts this far below the top edge, so its first label
        // (centered on its line) is not cut off by the day headers.
        const MARGIN = 8;
        const filled = (frameMinutes: number) => Math.round((720 - MARGIN) * 1440 / frameMinutes);
        const pxBelowTop = (minutes: number) => (minutes / 1440) * height() - scrollTop();

        it('fills the view with the time frame, its start just below the top', () => {
            render(<WeekView {...defaultProps} viewRange={{ startMinutes: 480, endMinutes: 1005 }} />);
            // 8:00–16:45 is 8.75 h of 24: the day is about 24/8.75 times the visible height.
            expect(height()).toBe(filled(525));
            expect(pxBelowTop(480)).toBeCloseTo(MARGIN, 0);
            // The frame's end is at the bottom of the visible area.
            expect(pxBelowTop(1005)).toBeCloseTo(720, 0);
        });

        it('zooms in at most 6× for a short frame, and not at all for the whole day', () => {
            const { unmount } = render(<WeekView {...defaultProps} viewRange={{ startMinutes: 600, endMinutes: 660 }} />);
            expect(height()).toBe(720 * 6);
            expect(pxBelowTop(600)).toBeCloseTo(MARGIN, 0);
            unmount();
            render(<WeekView {...defaultProps} viewRange={{ startMinutes: 0, endMinutes: 1440 }} />);
            expect(height()).toBe(720);
            expect(scrollTop()).toBe(0);
        });

        it('follows a changed frame until the user zooms', () => {
            const { rerender } = render(<WeekView {...defaultProps} viewRange={{ startMinutes: 480, endMinutes: 1005 }} />);
            rerender(<WeekView {...defaultProps} viewRange={{ startMinutes: 540, endMinutes: 1020 }} />);
            expect(height()).toBe(filled(480)); // 9:00–17:00 = 8 h
            expect(pxBelowTop(540)).toBeCloseTo(MARGIN, 0);

            fireEvent.wheel(screen.getByTestId('week-scroll'), { deltaY: -100 });
            const zoomed = height();
            rerender(<WeekView {...defaultProps} viewRange={{ startMinutes: 600, endMinutes: 720 }} />);
            expect(height()).toBe(zoomed); // the user's own view stays
        });

        it('scrolls with Ctrl + wheel instead of zooming (and keeps the browser from zooming the page)', () => {
            render(<WeekView {...defaultProps} viewRange={{ startMinutes: 480, endMinutes: 1005 }} />);
            const scroll = screen.getByTestId('week-scroll');
            const [before, top] = [height(), scrollTop()];

            expect(fireEvent.wheel(scroll, { deltaY: 100, ctrlKey: true })).toBe(false); // prevented
            expect(height()).toBe(before);
            expect(scrollTop()).toBeCloseTo(top + 100, 0);

            // A wheel that counts in lines (Firefox) moves 16 px per line.
            fireEvent.wheel(scroll, { deltaY: -3, deltaMode: 1, ctrlKey: true });
            expect(scrollTop()).toBeCloseTo(top + 100 - 48, 0);
        });
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
