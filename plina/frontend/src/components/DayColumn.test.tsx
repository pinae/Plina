import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DayColumn } from './DayColumn';
import type { ViewTask } from './WeekViewTask';

// Mock WeekViewTask
vi.mock('./WeekViewTask', () => ({
    WeekViewTask: ({ task }: { task: ViewTask }) => (
        <div data-testid="week-view-task" style={{ height: '50px' }}>
            {task.title}
        </div>
    )
}));

describe('DayColumn', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    const mockCreateTask = vi.fn();
    const defaultProps = {
        date: new Date('2024-01-01T12:00:00'),
        tasks: [] as ViewTask[],
        currentTime: null,
        onCreateTask: mockCreateTask,
        columnHeight: 1000,
    };

    it('renders tasks passed as children', () => {
        const tasks: ViewTask[] = [{
            title: 'Test Task',
            startTime: '2024-01-01T10:00:00',
            duration: 60,
            color: 'blue',
            manuallySet: false,
            description: '',
            tags: [],
            continues: false,
        }];
        render(<DayColumn {...defaultProps} tasks={tasks} />);
        expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    it('renders hour dividers', () => {
        render(<DayColumn {...defaultProps} />);
        const dividers = screen.getAllByTestId('hour-divider');
        expect(dividers).toHaveLength(24);
    });

    it('renders current time line when provided', () => {
        const now = new Date('2024-01-01T12:00:00');
        render(<DayColumn {...defaultProps} currentTime={now} />);
        expect(screen.getByTestId('current-time-line')).toBeInTheDocument();
    });

    it('calls onCreateTask with 1h duration on click', () => {
        render(<DayColumn {...defaultProps} />);
        const content = screen.getByTestId('day-column-content');

        // Mock getBoundingClientRect
        vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            left: 0,
            width: 100,
            height: 1000,
            bottom: 1000,
            right: 100,
            x: 0,
            y: 0,
            toJSON: () => { }
        });

        // Click at 500px (middle of 1000px height) -> 12:00
        fireEvent.mouseDown(content, { clientY: 500, button: 0 });
        fireEvent.mouseUp(content, { clientY: 500, button: 0 });

        expect(mockCreateTask).toHaveBeenCalled();
        const callArgs = mockCreateTask.mock.calls[0];
        const createdDate = callArgs[0] as Date;
        const duration = callArgs[1] as number;

        // 12:00 is exactly in the middle
        expect(createdDate.getHours()).toBe(12);
        expect(duration).toBe(60);
    });

    it('creates task with specific duration on drag', () => {
        render(<DayColumn {...defaultProps} />);
        const content = screen.getByTestId('day-column-content');

        vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            left: 0,
            width: 100,
            height: 1000,
            bottom: 1000,
            right: 100,
            x: 0,
            y: 0,
            toJSON: () => { }
        });

        // Drag from 0px (00:00) to 125px (03:00 approx, 1000px=24h -> 41.6px/h)
        // 125px / 1000 * 24 * 60 = 180 min = 3 hours
        fireEvent.mouseDown(content, { clientY: 0, button: 0 });
        fireEvent.mouseUp(content, { clientY: 125, button: 0 });

        expect(mockCreateTask).toHaveBeenCalled();
        const callArgs = mockCreateTask.mock.lastCall!;
        const duration = callArgs[1] as number;

        // 125/1000 = 1/8. 24h * 1/8 = 3h = 180min. 
        // Logic rounds to nearest 15min.
        expect(duration).toBe(180);
    });

    it('does not trigger onCreateTask when clicking a child task', () => {
        const tasks: ViewTask[] = [{
            title: 'Test Task',
            startTime: '2024-01-01T10:00:00',
            duration: 60,
            color: 'blue',
            manuallySet: false,
            description: '',
            tags: [],
            continues: false,
        }];
        render(<DayColumn {...defaultProps} tasks={tasks} />);

        const content = screen.getByTestId('day-column-content');
        vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            height: 1000,
            left: 0, width: 100, bottom: 1000, right: 100, x: 0, y: 0, toJSON: () => { }
        });

        const taskElement = screen.getByTestId('week-view-task');

        // Try to drag/click on the task
        fireEvent.mouseDown(taskElement, { bubbles: true, clientY: 10 });
        fireEvent.mouseUp(taskElement, { bubbles: true, clientY: 10 });

        expect(mockCreateTask).not.toHaveBeenCalled();
    });
});
