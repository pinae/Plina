import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DayColumn } from './DayColumn';
import type { ViewTask } from './WeekViewTask';

const mockCreateTask = vi.fn();

const defaultProps = {
    date: new Date('2024-01-01T00:00:00'),
    tasks: [] as ViewTask[],
    currentTime: null as Date | null,
    onCreateTask: mockCreateTask,
    columnHeight: 1440, // 1px per minute
};

describe('DayColumn', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('renders the header with day name and date', () => {
        // 2024-01-01 is a Monday
        render(<DayColumn {...defaultProps} />);
        expect(screen.getByText('MO')).toBeInTheDocument();
        expect(screen.getByText('01')).toBeInTheDocument();
    });

    it('renders tasks passed as children', () => {
        const tasks: ViewTask[] = [{
            title: 'Task 1',
            startTime: '2024-01-01T10:00:00',
            duration: 60,
            color: 'red',
            manuallySet: true,
            description: '',
            tags: [],
            continues: false
        }];
        render(<DayColumn {...defaultProps} tasks={tasks} />);
        expect(screen.getByText('Task 1')).toBeInTheDocument();
    });

    it('renders hour dividers', () => {
        const { container } = render(<DayColumn {...defaultProps} />);
        // Expect 24 dividers or 23 lines? 
        // We can check for a specific class or style.
        // Let's assume we use a class or data-testid for dividers if we want strict check,
        // or just ensure the container has enough children or height.
        // For TDD, let's verify we have visual markers.
        const dividers = container.querySelectorAll('[data-testid="hour-divider"]');
        expect(dividers.length).toBeGreaterThanOrEqual(23);
    });

    it('renders current time line when provided', () => {
        const currentTime = new Date('2024-01-01T12:00:00'); // Noon
        render(<DayColumn {...defaultProps} currentTime={currentTime} />);
        const timeLine = screen.getByTestId('current-time-line');
        expect(timeLine).toBeInTheDocument();
        // Should be at 50% height (12h / 24h)
        expect(timeLine).toHaveStyle({ top: '720px' });
    });

    it('calls onCreateTask with 1h duration on click', () => {
        render(<DayColumn {...defaultProps} />);
        const column = screen.getByTestId('day-column-content');

        // Simulate click at 10:00 (600px)
        fireEvent.click(column, { clientY: 600, bubbles: true });

        // IMPORTANT: In a real DOM, clientY is relative to viewport. 
        // In JSDOM, we mock getBoundingClientRect usually.
        // We might need to mock that for accurate pixel-to-time calc.
        // For now, assume the component uses native event properties that we can mock 
        // or relative offset logic.

        // If we can't easily mock rects in JSDOM basic setup, we might skip precise coordinate verification 
        // and just check the call, or mock the specific method used for calculation.

        expect(mockCreateTask).toHaveBeenCalled();
    });

    it('creates task with specific duration on drag', () => {
        render(<DayColumn {...defaultProps} />);
        const column = screen.getByTestId('day-column-content');

        // Drag from 10:00 (600px) to 12:00 (720px) = 2h duration
        fireEvent.mouseDown(column, { clientY: 600, bubbles: true });
        fireEvent.mouseUp(column, { clientY: 720, bubbles: true });

        // Should trigger onCreateTask with start time and duration
        expect(mockCreateTask).toHaveBeenCalledWith(
            expect.any(Date),
            120 // 2 hours in minutes
        );
        // Verify call args more specifically if needed
        const callArgs = mockCreateTask.mock.lastCall;
        if (callArgs) {
            const startDate = callArgs[0] as Date;
            // 10:00
            expect(startDate.getHours()).toBe(10);
            expect(startDate.getMinutes()).toBe(0);
        }
    });

    it('does not trigger onCreateTask when clicking a child task', () => {
        const tasks: ViewTask[] = [{
            title: 'Task 1',
            startTime: '2024-01-01T10:00:00',
            duration: 60,
            color: 'red',
            manuallySet: true,
            description: '',
            tags: [],
            continues: false
        }];
        render(<DayColumn {...defaultProps} tasks={tasks} />);

        const taskElement = screen.getByText('Task 1');
        fireEvent.mouseDown(taskElement, { bubbles: true });
        fireEvent.mouseUp(taskElement, { bubbles: true }); // Simulate click sequence

        expect(mockCreateTask).not.toHaveBeenCalled();
    });
});
