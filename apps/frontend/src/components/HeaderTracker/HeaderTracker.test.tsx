import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeaderTracker } from './HeaderTracker.tsx';
import { formatElapsed } from '../../utils/duration.ts';
import type { TrackerControls } from '../../hooks/useTracker.ts';
import { makeTask } from '../../testing/treeFixtures.ts';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const controls = (over: Partial<TrackerControls> = {}): TrackerControls => ({
    tracked: null, outsidePath: null, next: null,
    pickable: { inProject: [], others: [] }, defaultDurationMinutes: 60,
    start: vi.fn(), stop: vi.fn(), complete: vi.fn(), toggle: vi.fn(),
    pending: false, error: null, clearError: vi.fn(), ...over,
});

describe('formatElapsed', () => {
    it.each([[0, '00:00:00'], [59, '00:00:59'], [3725, '01:02:05'], [36000, '10:00:00']])('%i s → %s', (s, text) => {
        expect(formatElapsed(s)).toBe(text);
    });
});

describe('HeaderTracker', () => {
    afterEach(cleanup);

    it('shows the running task with a live timer, stop and complete', () => {
        const c = controls({ tracked: makeTask('cad', { header: 'CAD', active_tracking_start: minutesAgo(5) }) });
        const onEdit = vi.fn();
        render(<HeaderTracker controls={c} onEditTask={onEdit} />);

        expect(screen.getByTestId('tracker-elapsed').textContent).toMatch(/^00:0[45]:\d\d$/);
        fireEvent.click(screen.getByRole('button', { name: 'CAD' }));
        expect(onEdit).toHaveBeenCalledWith('cad');
        fireEvent.click(screen.getByRole('button', { name: /stop tracking/i }));
        expect(c.stop).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /complete/i }));
        expect(c.complete).toHaveBeenCalled();
    });

    it('turns amber and shows how far it is over the estimate', () => {
        const c = controls({ tracked: makeTask('cad', {
            header: 'CAD', duration: '01:00:00', time_spent: '00:55:00', active_tracking_start: minutesAgo(10),
        }) });
        render(<HeaderTracker controls={c} onEditTask={vi.fn()} />);
        expect(screen.getByTestId('tracker-over')).toHaveTextContent('+0:05 over');
    });

    it('uses the default duration for an unestimated task', () => {
        const c = controls({
            defaultDurationMinutes: 30,
            tracked: makeTask('x', { header: 'Call', duration: null, active_tracking_start: minutesAgo(40) }),
        });
        render(<HeaderTracker controls={c} onEditTask={vi.fn()} />);
        expect(screen.getByTestId('tracker-over')).toHaveTextContent('+0:10 over');
    });

    it('prefixes a task outside the active project with its project', () => {
        const c = controls({
            tracked: makeTask('cad', { header: 'CAD', active_tracking_start: minutesAgo(1) }),
            outsidePath: 'T250 › Hardware Design',
        });
        render(<HeaderTracker controls={c} onEditTask={vi.fn()} />);
        expect(screen.getByText('T250 › Hardware Design')).toBeInTheDocument();
    });

    it('offers the next planned task of the active project when idle', () => {
        const c = controls({ next: {
            task_id: 'cad', header: 'CAD', start_time: '2026-09-28T13:00:00Z', duration: 3600,
            warnings: [], is_fixed: false, is_appointment: false, hex_color: null,
        } });
        render(<HeaderTracker controls={c} onEditTask={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start next: CAD/i }));
        expect(c.start).toHaveBeenCalledWith('cad');
    });

    it('lets the user pick any task, the active project first', () => {
        const c = controls({ pickable: {
            inProject: [makeTask('cad', { header: 'CAD' })],
            others: [makeTask('milk', { header: 'Buy milk' })],
        } });
        render(<HeaderTracker controls={c} onEditTask={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /choose a task to start/i }));
        const items = screen.getAllByRole('menuitem').map(item => item.textContent);
        expect(items).toEqual(['CAD', 'Buy milk']);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Buy milk' }));
        expect(c.start).toHaveBeenCalledWith('milk');
    });

    it('says "Start a task…" when nothing is planned', () => {
        render(<HeaderTracker controls={controls()} onEditTask={vi.fn()} />);
        expect(screen.getByRole('button', { name: /start a task/i })).toBeInTheDocument();
    });

    it('shows errors, e.g. a blocked start', () => {
        const c = controls({ error: 'Can’t start yet — first finish “Design schema”.' });
        render(<HeaderTracker controls={c} onEditTask={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent('first finish “Design schema”');
    });
});

describe('HeaderTracker compact (phones, UI-9)', () => {
    afterEach(cleanup);

    it('shows ⏹ time ✓ without the task name; the time opens the task (spec §3 mobile)', () => {
        const c = controls({ tracked: makeTask('cad', { header: 'CAD', active_tracking_start: minutesAgo(5) }) });
        const onEdit = vi.fn();
        render(<HeaderTracker compact controls={c} onEditTask={onEdit} />);

        expect(screen.queryByText('CAD')).toBeNull();
        const time = screen.getByRole('button', { name: /tracking CAD/i });
        expect(time).toHaveTextContent(/^00:0[45]:\d\d$/);
        fireEvent.click(time);
        expect(onEdit).toHaveBeenCalledWith('cad');
        fireEvent.click(screen.getByRole('button', { name: /stop tracking/i }));
        expect(c.stop).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /complete/i }));
        expect(c.complete).toHaveBeenCalled();
    });

    it('keeps the amber colour over the estimate but drops the "+… over" text', () => {
        const c = controls({ tracked: makeTask('cad', {
            header: 'CAD', duration: '01:00:00', time_spent: '00:55:00', active_tracking_start: minutesAgo(10),
        }) });
        render(<HeaderTracker compact controls={c} onEditTask={vi.fn()} />);
        expect(screen.queryByTestId('tracker-over')).toBeNull();
        expect(screen.getByTestId('tracker-elapsed')).toHaveAttribute('data-over', 'true');
    });

    it('idle: ▶ starts the next task, named only in its label', () => {
        const next = { task_id: 'cad', header: 'CAD', start_time: minutesAgo(-10), duration: 3600,
            warnings: [], is_fixed: false, is_appointment: false, hex_color: null };
        const c = controls({ next });
        render(<HeaderTracker compact controls={c} onEditTask={vi.fn()} />);
        expect(screen.queryByText(/Next:/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'start next: CAD' }));
        expect(c.start).toHaveBeenCalledWith('cad');
    });

    it('idle with nothing planned: ▶ opens the task picker', () => {
        const c = controls({ pickable: { inProject: [makeTask('cad', { header: 'CAD' })], others: [] } });
        render(<HeaderTracker compact controls={c} onEditTask={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /start a task/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'CAD' }));
        expect(c.start).toHaveBeenCalledWith('cad');
    });
});

