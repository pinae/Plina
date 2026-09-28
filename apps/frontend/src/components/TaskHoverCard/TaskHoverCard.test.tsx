import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { TaskHoverCard } from './TaskHoverCard.tsx';
import type { ViewTask } from '../WeekViewTask/WeekViewTask.tsx';

const task = (over: Partial<ViewTask> = {}): ViewTask => ({
    title: 'Write the quarterly report for the board', startTime: '2026-07-08T09:00:00',
    duration: 90, color: '#3357ff', manuallySet: false, description: '',
    tags: [], continues: false, taskId: 't1', ...over,
});

describe('TaskHoverCard', () => {
    afterEach(cleanup);

    it('shows the full title, the time range and the duration', () => {
        render(<TaskHoverCard task={task()} />);
        expect(screen.getByText('Write the quarterly report for the board')).toBeInTheDocument();
        const time = screen.getByTestId('hover-time').textContent!;
        expect(time).toMatch(/09:00/);
        expect(time).toMatch(/10:30/);
        expect(time).toMatch(/1h 30m/);
    });

    it('names the kind of task', () => {
        const { rerender } = render(<TaskHoverCard task={task()} />);
        expect(screen.getByText(/auto-planned/i)).toBeInTheDocument();
        rerender(<TaskHoverCard task={task({ isAppointment: true, manuallySet: true })} />);
        expect(screen.getByText(/appointment/i)).toBeInTheDocument();
        rerender(<TaskHoverCard task={task({ manuallySet: true })} />);
        expect(screen.getByText(/fixed/i)).toBeInTheDocument();
    });

    it('shows warnings, invalid state, continuation and tracking', () => {
        render(<TaskHoverCard task={task({
            description: 'Misses its deadline', valid: false, continues: true, trackingActive: true,
        })} />);
        expect(screen.getByText('Misses its deadline')).toBeInTheDocument();
        expect(screen.getByText(/will be re-planned/i)).toBeInTheDocument();
        expect(screen.getByText(/continues on the next day/i)).toBeInTheDocument();
        expect(screen.getByText(/tracking/i)).toBeInTheDocument();
    });
});
