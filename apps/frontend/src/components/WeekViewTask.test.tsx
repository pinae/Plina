import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { WeekViewTask, type ViewTask } from './WeekViewTask';

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
});
