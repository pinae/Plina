import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DayColumn } from './DayColumn.tsx';
import type { ViewTask } from '../WeekViewTask/WeekViewTask.tsx';
import type { DayZone } from '../../utils/planToWeek.ts';

const mockRect = (el: HTMLElement, height = 1000) =>
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: 0, left: 0, width: 100, height, bottom: height, right: 100, x: 0, y: 0, toJSON: () => { },
    } as DOMRect);

const zone: DayZone = {
    id: 'b1', start: new Date('2024-01-01T09:00:00'), end: new Date('2024-01-01T13:00:00'),
    color: '#539dad', label: 'Deep Work', persisted: true, typeId: 1,
    topMinutes: 540, heightMinutes: 240,
};

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

    it('keeps no stale cards when a task has two slices on one day (regression)', () => {
        // Two slices of the same task (e.g. a morning and an afternoon bucket)
        // shared a React key, so switching weeks left one card behind.
        const slice = (startTime: string, title: string): ViewTask => ({
            title, startTime, duration: 60, color: '#123456', manuallySet: false,
            description: '', tags: [], continues: false, taskId: 'same-task',
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { rerender } = render(<DayColumn {...defaultProps} tasks={[
            slice('2024-01-01T09:00:00', 'Design schema'), slice('2024-01-01T14:00:00', 'Design schema'),
        ]} />);
        expect(screen.getAllByTestId('week-view-task')).toHaveLength(2);

        rerender(<DayColumn {...defaultProps} tasks={[slice('2024-01-01T10:00:00', 'Other')]} />);
        rerender(<DayColumn {...defaultProps} tasks={[]} />);

        expect(screen.queryAllByTestId('week-view-task')).toHaveLength(0);
        const keyWarnings = consoleError.mock.calls.filter(call => String(call[0]).includes('same key'));
        expect(keyWarnings).toHaveLength(0);
    });

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

    it('renders buckets in the bucket column and edits one on click', () => {
        const onZoneClick = vi.fn();
        render(<DayColumn {...defaultProps} zones={[zone]} onZoneClick={onZoneClick} />);
        const block = screen.getByTestId('bucket-zone');
        expect(screen.getByText('Deep Work')).toBeInTheDocument();
        fireEvent.mouseDown(block, { clientY: 300, button: 0 });
        fireEvent.mouseUp(window, { clientY: 300 });
        expect(onZoneClick).toHaveBeenCalledWith(zone);
    });

    const sampleTask: ViewTask = {
        title: 'Design', startTime: '2024-01-01T10:00:00', duration: 60,
        color: 'blue', manuallySet: false, description: '', tags: [],
        continues: false, taskId: 't1',
    };
    const apptTask: ViewTask = {
        ...sampleTask, taskId: 'a1', title: 'Meeting', isAppointment: true, manuallySet: true,
    };

    it('edits a task on a plain click of its card', () => {
        const onTaskEdit = vi.fn();
        render(<DayColumn {...defaultProps} tasks={[sampleTask]} onTaskEdit={onTaskEdit} onTaskChange={vi.fn()} />);
        fireEvent.click(screen.getByTestId('week-view-task'));
        expect(onTaskEdit).toHaveBeenCalledWith('t1');
    });

    it('moves an appointment by dragging its body and does not create a task (regression)', () => {
        const onTaskChange = vi.fn();
        render(<DayColumn {...defaultProps} tasks={[apptTask]} onTaskChange={onTaskChange} />);
        const card = screen.getByTestId('week-view-task');
        fireEvent.mouseDown(card, { clientY: 100, button: 0 });
        fireEvent.mouseMove(window, { clientY: 160 });
        fireEvent.mouseUp(window, { clientY: 160 });
        expect(onTaskChange).toHaveBeenCalledTimes(1);
        expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('dragging a bucket moves it and does not create a task (regression)', () => {
        const onZoneChange = vi.fn();
        render(<DayColumn {...defaultProps} zones={[zone]} onZoneChange={onZoneChange} />);
        const block = screen.getByTestId('bucket-zone');
        fireEvent.mouseDown(block, { clientY: 540, button: 0 });
        fireEvent.mouseMove(window, { clientY: 600 });
        fireEvent.mouseUp(window, { clientY: 600 });
        expect(onZoneChange).toHaveBeenCalledTimes(1);
        expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('creates a task by dragging in the bucket column', () => {
        render(<DayColumn {...defaultProps} />);
        const bucketCol = screen.getByTestId('bucket-column');
        mockRect(bucketCol);
        fireEvent.mouseDown(bucketCol, { clientY: 0, button: 0 });
        fireEvent.mouseUp(bucketCol, { clientY: 125 });
        expect(mockCreateTask).toHaveBeenCalled();
        expect(mockCreateTask.mock.lastCall![1]).toBe(180);
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

    it('puts overlapping cards side by side (e.g. your appointment and an invitation)', () => {
        const card = (title: string, startTime: string, duration: number): ViewTask => ({
            title, startTime, duration, color: '#123456', manuallySet: true, description: '', tags: [],
            continues: false, taskId: title, isAppointment: true,
        });
        render(<DayColumn {...defaultProps} tasks={[
            card('Kickoff', '2024-01-01T14:00:00', 60), card('Project kickoff', '2024-01-01T14:00:00', 90),
            card('Later', '2024-01-01T17:00:00', 60),
        ]} />);
        const [mine, invitation, later] = screen.getAllByTestId('week-view-task');
        expect(invitation).toHaveStyle({ left: '0%' });
        expect(mine).toHaveStyle({ left: '50%' });
        expect(getComputedStyle(mine).width).toBe('calc(50% - 1px)');
        expect(getComputedStyle(later).width).toBe('calc(100% - 1px)');
    });
});
