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

    it('draws a faint solid border so same-coloured tasks are distinguishable', () => {
        render(<WeekViewTask task={createMockTask()} columnHeight={1000} />);
        expect(screen.getByTestId('week-view-task')).toHaveStyle({ borderTopStyle: 'solid' });
    });

    it('fades an invalid auto-planned card to 30%', () => {
        render(<WeekViewTask task={createMockTask({ manuallySet: false, valid: false })} columnHeight={1000} />);
        expect(screen.getByTestId('week-view-task')).toHaveStyle({ opacity: '0.3' });
    });

    it('does not fade an invalid appointment (appointments never invalidate)', () => {
        render(<WeekViewTask task={createMockTask({ isAppointment: true, manuallySet: true, valid: false })} columnHeight={1000} />);
        expect(screen.getByTestId('week-view-task')).toHaveStyle({ opacity: '1' });
    });

    it('shrinks an overlapped appointment to half the column on the given side', () => {
        render(<WeekViewTask task={createMockTask({ isAppointment: true, manuallySet: true, shrinkSide: 'right' })} columnHeight={1000} />);
        const box = screen.getByTestId('week-view-task');
        expect(box).toHaveStyle({ width: '50%', left: '50%' });
    });

    it('edits a non-appointment task on a plain click', () => {
        const onEdit = vi.fn();
        render(<WeekViewTask task={createMockTask({ taskId: 't1' })} columnHeight={1440} onEdit={onEdit} />);
        fireEvent.click(screen.getByTestId('week-view-task'));
        expect(onEdit).toHaveBeenCalledWith('t1');
    });

    it('moves an appointment when its body is dragged; a non-appointment does not', () => {
        // Appointment: body drag moves it.
        const onChange = vi.fn();
        const appt = createMockTask({ taskId: 'a1', isAppointment: true, manuallySet: true, startTime: '2024-01-01T09:00:00', duration: 60 });
        const { unmount } = render(<WeekViewTask task={appt} columnHeight={1440} onChange={onChange} />);
        fireEvent.mouseDown(screen.getByTestId('week-view-task'), { clientY: 540, button: 0 });
        fireEvent.mouseMove(window, { clientY: 600 });
        fireEvent.mouseUp(window, { clientY: 600 });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect((onChange.mock.calls[0][1] as Date).getHours()).toBe(10);
        unmount();

        // Non-appointment: dragging the body must NOT move it (resize-only).
        const autoChange = vi.fn();
        render(<WeekViewTask task={createMockTask({ taskId: 't1', manuallySet: false })} columnHeight={1440} onChange={autoChange} />);
        fireEvent.mouseDown(screen.getByTestId('week-view-task'), { clientY: 540, button: 0 });
        fireEvent.mouseMove(window, { clientY: 600 });
        fireEvent.mouseUp(window, { clientY: 600 });
        expect(autoChange).not.toHaveBeenCalled();
    });

    it('emits a live drag while moving an appointment and clears it on release', () => {
        const onDragChange = vi.fn();
        const appt = createMockTask({ taskId: 'a1', isAppointment: true, manuallySet: true, startTime: '2024-01-01T09:00:00', duration: 60 });
        render(<WeekViewTask task={appt} columnHeight={1440} onChange={vi.fn()} onDragChange={onDragChange} />);

        fireEvent.mouseDown(screen.getByTestId('week-view-task'), { clientY: 540, button: 0 });
        fireEvent.mouseMove(window, { clientY: 600 });

        const drag = onDragChange.mock.calls.at(-1)![0];
        expect(drag.mode).toBe('move');
        expect((drag.start as Date).getHours()).toBe(10);

        fireEvent.mouseUp(window, { clientY: 600 });
        expect(onDragChange).toHaveBeenLastCalledWith(null);
    });

    it('moves an appointment to another day when dragged horizontally (multi-day)', () => {
        const onChange = vi.fn();
        const resolveDay = vi.fn(() => new Date('2024-01-05T00:00:00'));
        const appt = createMockTask({ taskId: 'a1', isAppointment: true, manuallySet: true, startTime: '2024-01-01T09:00:00', duration: 60 });
        render(<WeekViewTask task={appt} columnHeight={1440} onChange={onChange} resolveDay={resolveDay} />);

        fireEvent.mouseDown(screen.getByTestId('week-view-task'), { clientY: 540, clientX: 100, button: 0 });
        fireEvent.mouseMove(window, { clientY: 600, clientX: 900 });
        fireEvent.mouseUp(window, { clientY: 600, clientX: 900 });

        expect(resolveDay).toHaveBeenCalled();
        const [, start] = onChange.mock.calls[0];
        expect((start as Date).getDate()).toBe(5);
        expect((start as Date).getHours()).toBe(10);
    });

    it('resizes a non-appointment from the bottom handle, keeping the start', () => {
        const onChange = vi.fn();
        const task = createMockTask({ taskId: 't1', manuallySet: false, startTime: '2024-01-01T09:00:00', duration: 60 });
        render(<WeekViewTask task={task} columnHeight={1440} onChange={onChange} />);

        fireEvent.mouseDown(screen.getByTestId('task-resize-bottom'), { clientY: 600, button: 0 });
        fireEvent.mouseMove(window, { clientY: 660 });
        fireEvent.mouseUp(window, { clientY: 660 });

        expect(onChange).toHaveBeenCalledTimes(1);
        const [, start, duration] = onChange.mock.calls[0];
        expect((start as Date).getHours()).toBe(9);
        expect(duration).toBe(120);
    });
});
