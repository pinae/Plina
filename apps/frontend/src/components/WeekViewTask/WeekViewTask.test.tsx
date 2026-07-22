import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WeekViewTask, type ViewTask } from './WeekViewTask.tsx';

// Helper function to create a mock task
const createMockTask = (overrides?: Partial<ViewTask>): ViewTask => ({
    title: 'Test Task',
    startTime: '2024-01-01T10:00:00',
    duration: 60,
    color: '#FF0000',
    manuallySet: true,
    description: 'This is a description',
    tags: ['#00FF00'],
    continues: false,
    ...overrides,
});

describe('WeekViewTask', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the title', () => {
        const task = createMockTask({ title: 'My Important Task' });
        render(<WeekViewTask task={task} columnHeight={1000} />);
        expect(screen.getByText('My Important Task')).toBeInTheDocument();
    });

    it('renders the description', () => {
        const task = createMockTask({ description: 'Detailed description' });
        render(<WeekViewTask task={task} columnHeight={1000} />);
        expect(screen.getByText('Detailed description')).toBeInTheDocument();
    });

    it('renders with correct styles for title truncation', () => {
        const task = createMockTask({ title: 'A very long title that should be truncated' });
        render(<WeekViewTask task={task} columnHeight={1000} />);
        const title = screen.getByText('A very long title that should be truncated');
        expect(title).toHaveStyle({
            overflow: 'hidden',
        });
    });

    it('uses pastel color when manuallySet is false', () => {
        const task = createMockTask({ color: '#FF0000', manuallySet: false });
        render(<WeekViewTask task={task} columnHeight={1000} />);

        const box = screen.getByTestId('week-view-task');
        expect(box).not.toHaveStyle({ backgroundColor: '#FF0000' });

        cleanup();

        const manualTask = createMockTask({ color: '#FF0000', manuallySet: true });
        render(<WeekViewTask task={manualTask} columnHeight={1000} />);
        const manualBox = screen.getByTestId('week-view-task');
        expect(manualBox).toHaveStyle({ backgroundColor: '#FF0000' });
    });

    it('calculates position and height correctly', () => {
        const task = createMockTask({
            startTime: '2024-01-01T06:00:00',
            duration: 60,
        });
        const columnHeight = 1440;
        render(<WeekViewTask task={task} columnHeight={columnHeight} />);

        const box = screen.getByTestId('week-view-task');
        expect(box).toHaveStyle({
            top: '360px',
            height: '60px',
            position: 'absolute',
        });
    });

    it('renders bottom border double if continues', () => {
        const task = createMockTask({ continues: true });
        render(<WeekViewTask task={task} columnHeight={1000} />);
        const box = screen.getByTestId('week-view-task');
        expect(box).toHaveStyle({
            borderBottomStyle: 'double',
            // Skip color/width check to avoid JSDOM quirks for now
        });
    });

    it('calls onEdit with the task id on a plain click (press-release, no drag)', () => {
        const onEdit = vi.fn();
        const task = createMockTask({ taskId: 't1' });
        render(<WeekViewTask task={task} columnHeight={1440} onEdit={onEdit} />);
        const card = screen.getByTestId('week-view-task');
        fireEvent.mouseDown(card, { clientY: 100, button: 0 });
        fireEvent.mouseUp(window, { clientY: 100 });
        expect(onEdit).toHaveBeenCalledWith('t1');
    });

    it('moves the task when the body is dragged (regression: dragging tasks works)', () => {
        const onChange = vi.fn();
        const task = createMockTask({ taskId: 't1', startTime: '2024-01-01T09:00:00', duration: 60 });
        render(<WeekViewTask task={task} columnHeight={1440} onChange={onChange} />);

        // 1440px column: 1px = 1min. Drag the body down 60px -> 09:00 -> 10:00.
        fireEvent.mouseDown(screen.getByTestId('week-view-task'), { clientY: 540, button: 0 });
        fireEvent.mouseMove(window, { clientY: 600 });
        fireEvent.mouseUp(window, { clientY: 600 });

        expect(onChange).toHaveBeenCalledTimes(1);
        const [id, start, duration] = onChange.mock.calls[0];
        expect(id).toBe('t1');
        expect((start as Date).getHours()).toBe(10);
        expect((start as Date).getMinutes()).toBe(0);
        expect(duration).toBe(60); // duration unchanged by a move
    });

    it('moves the task to another day when dragged horizontally (multi-day)', () => {
        const onChange = vi.fn();
        const resolveDay = vi.fn(() => new Date('2024-01-05T00:00:00'));
        const task = createMockTask({ taskId: 't1', startTime: '2024-01-01T09:00:00', duration: 60 });
        render(<WeekViewTask task={task} columnHeight={1440} onChange={onChange} resolveDay={resolveDay} />);

        fireEvent.mouseDown(screen.getByTestId('week-view-task'), { clientY: 540, clientX: 100, button: 0 });
        fireEvent.mouseMove(window, { clientY: 600, clientX: 900 });
        fireEvent.mouseUp(window, { clientY: 600, clientX: 900 });

        expect(resolveDay).toHaveBeenCalled();
        const [id, start, duration] = onChange.mock.calls[0];
        expect(id).toBe('t1');
        expect((start as Date).getDate()).toBe(5);   // moved to Jan 5
        expect((start as Date).getHours()).toBe(10); // 09:00 + 60min vertical
        expect(duration).toBe(60);
    });

    it('resizes from the bottom handle, keeping the start and growing duration', () => {
        const onChange = vi.fn();
        const task = createMockTask({ taskId: 't1', startTime: '2024-01-01T09:00:00', duration: 60 });
        render(<WeekViewTask task={task} columnHeight={1440} onChange={onChange} />);

        // Drag the bottom edge down 60px -> +1h.
        fireEvent.mouseDown(screen.getByTestId('task-resize-bottom'), { clientY: 600, button: 0 });
        fireEvent.mouseMove(window, { clientY: 660 });
        fireEvent.mouseUp(window, { clientY: 660 });

        expect(onChange).toHaveBeenCalledTimes(1);
        const [id, start, duration] = onChange.mock.calls[0];
        expect(id).toBe('t1');
        expect((start as Date).getHours()).toBe(9);
        expect((start as Date).getMinutes()).toBe(0);
        expect(duration).toBe(120);
    });
});
