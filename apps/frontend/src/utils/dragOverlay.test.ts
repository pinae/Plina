import { describe, it, expect } from 'vitest';
import { applyDragOverlay } from './dragOverlay.ts';
import type { ActiveDrag, ViewTask } from '../components/WeekViewTask/WeekViewTask.tsx';

const base: ViewTask = {
    title: '', startTime: '2026-07-08T09:00:00', duration: 60, color: '#123',
    manuallySet: false, description: '', tags: [], continues: false,
};

const auto = (over: Partial<ViewTask>): ViewTask => ({ ...base, manuallySet: false, isAppointment: false, ...over });
const appt = (over: Partial<ViewTask>): ViewTask => ({ ...base, manuallySet: true, isAppointment: true, ...over });

const draggedAppointment = (over: Partial<ActiveDrag> = {}): ActiveDrag => ({
    taskId: 'drag', mode: 'move', start: new Date('2026-07-08T09:00:00'),
    durationMinutes: 60, color: '#123', title: 'Appt', isAppointment: true,
    cursorHalf: 'left', ...over,
});

const find = (tasks: ViewTask[], id: string) => tasks.find(t => t.taskId === id)!;

describe('applyDragOverlay', () => {
    it('invalidates an auto-planned task an appointment is dragged over', () => {
        const tasks = [auto({ taskId: 'a', startTime: '2026-07-08T09:30:00', duration: 60 })];
        const next = applyDragOverlay(tasks, draggedAppointment());
        // 09:00–10:00 (drag) overlaps 09:30–10:30 (auto).
        expect(find(next, 'a').valid).toBe(false);
    });

    it('leaves a non-overlapping auto task valid', () => {
        const tasks = [auto({ taskId: 'a', startTime: '2026-07-08T12:00:00', duration: 60 })];
        const next = applyDragOverlay(tasks, draggedAppointment());
        expect(find(next, 'a').valid).not.toBe(false);
    });

    it('shrinks an overlapped appointment away from the cursor and never invalidates it', () => {
        const tasks = [appt({ taskId: 'b', startTime: '2026-07-08T09:30:00', duration: 60 })];
        const next = applyDragOverlay(tasks, draggedAppointment({ cursorHalf: 'left' }));
        expect(find(next, 'b').shrinkSide).toBe('right'); // cursor left -> shrink right
        expect(find(next, 'b').valid).not.toBe(false);
    });

    it('does not touch the dragged task itself', () => {
        const tasks = [auto({ taskId: 'drag', startTime: '2026-07-08T09:00:00', duration: 60 })];
        const next = applyDragOverlay(tasks, draggedAppointment());
        expect(find(next, 'drag').valid).not.toBe(false);
    });

    it('a bottom-resize of an auto task invalidates another auto it now overlaps', () => {
        const tasks = [auto({ taskId: 'a', startTime: '2026-07-08T09:30:00', duration: 60 })];
        const resize: ActiveDrag = draggedAppointment({
            taskId: 'r', mode: 'resize-bottom', isAppointment: false,
            start: new Date('2026-07-08T08:00:00'), durationMinutes: 120, // 08:00–10:00
        });
        expect(find(applyDragOverlay(tasks, resize), 'a').valid).toBe(false);
    });

    it('a resize does not shrink appointments (only a moved appointment does)', () => {
        const tasks = [appt({ taskId: 'b', startTime: '2026-07-08T09:30:00', duration: 60 })];
        const resize: ActiveDrag = draggedAppointment({
            taskId: 'r', mode: 'resize-bottom', isAppointment: false,
            start: new Date('2026-07-08T08:00:00'), durationMinutes: 120,
        });
        expect(find(applyDragOverlay(tasks, resize), 'b').shrinkSide).toBeUndefined();
    });
});
