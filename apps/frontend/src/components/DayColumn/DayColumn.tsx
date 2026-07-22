import React, { useCallback, useRef } from 'react';
import { Box } from '@mui/material';
import { WeekViewTask, type ViewTask, type TaskActions } from '../WeekViewTask/WeekViewTask.tsx';
import { BucketBlock } from '../BucketBlock/BucketBlock.tsx';
import type { DayZone } from '../../utils/planToWeek.ts';

interface DayColumnProps {
    date: Date;
    tasks: ViewTask[];
    currentTime: Date | null;
    onCreateTask: (start: Date, duration: number) => void;
    columnHeight: number;
    zones?: DayZone[];
    actions?: TaskActions;
    onZoneClick?: (zone: DayZone) => void;
    onZoneChange?: (zone: DayZone, start: Date, durationMinutes: number) => void;
    onTaskEdit?: (taskId: string) => void;
    onTaskChange?: (taskId: string, start: Date, durationMinutes: number) => void;
    /** Map a pointer clientX to the day it is over (for cross-day moves). */
    resolveDay?: (clientX: number) => Date | null;
}

/** Width of the narrow bucket column that keeps buckets reachable even when a
 *  task is planned on top of them. */
const BUCKET_COLUMN_WIDTH = 42;

/**
 * A single day, split into a narrow bucket column (left) and the task column
 * (right).  Dragging on empty space in either column creates a task; buckets
 * and tasks handle their own move/resize/click.
 */
export const DayColumn: React.FC<DayColumnProps> = ({
    date, tasks, currentTime, onCreateTask, columnHeight, zones = [],
    actions, onZoneClick, onZoneChange, onTaskEdit, onTaskChange, resolveDay,
}) => {
    const dragStartRef = useRef<number | null>(null);

    // Drag-create: a press-drag-release on an *empty* area of a column produces
    // a new task.  The `target === currentTarget` guard means pressing on a
    // bucket or task (a descendant) never starts a create — those handle their
    // own move/resize/click.  Geometry comes from the pressed surface.
    const onSurfaceDown = useCallback((event: React.MouseEvent) => {
        if (event.button !== 0) return;
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        dragStartRef.current = ((event.clientY - rect.top) / columnHeight) * 1440;
    }, [columnHeight]);

    const onSurfaceUp = useCallback((event: React.MouseEvent) => {
        if (dragStartRef.current === null) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const endMinutes = ((event.clientY - rect.top) / columnHeight) * 1440;
        const startRaw = dragStartRef.current;
        dragStartRef.current = null;

        const startMin = Math.min(startRaw, endMinutes);
        const endMin = Math.max(startRaw, endMinutes);
        const durationRaw = endMin - startMin;

        const roundedStart = Math.round(startMin / 15) * 15;
        let duration = 60; // default click duration
        if (durationRaw > 15) {
            const roundedEnd = Math.round(endMin / 15) * 15;
            duration = roundedEnd - roundedStart || 15;
        }
        const start = new Date(date);
        start.setHours(0, roundedStart, 0, 0);
        onCreateTask(start, duration);
    }, [columnHeight, date, onCreateTask]);

    return (
        <Box sx={{ position: 'relative', height: columnHeight, display: 'flex' }}>
            {/* Decorative background: hour dividers + current time line. */}
            <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {Array.from({ length: 24 }).map((_, i) => (
                    <Box
                        key={i}
                        data-testid="hour-divider"
                        sx={{ position: 'absolute', top: `${(i / 24) * 100}%`, width: '100%', borderTop: '1px solid rgba(255,255,255,0.05)' }}
                    />
                ))}
                {currentTime && (
                    <Box
                        data-testid="current-time-line"
                        sx={{
                            position: 'absolute',
                            top: `${((currentTime.getHours() * 60 + currentTime.getMinutes()) / 1440) * columnHeight}px`,
                            width: '100%', borderTop: '2px solid white', zIndex: 3,
                        }}
                    />
                )}
            </Box>

            {/* Bucket column — buckets stay clickable/movable here even when a
                task is planned over the same time in the task column. */}
            <Box
                data-testid="bucket-column"
                sx={{ position: 'relative', width: BUCKET_COLUMN_WIDTH, flexShrink: 0, borderRight: '1px solid #333', cursor: 'copy' }}
                onMouseDown={onSurfaceDown}
                onMouseUp={onSurfaceUp}
            >
                {zones.map(zone => (
                    <BucketBlock
                        key={zone.id}
                        zone={zone}
                        columnHeight={columnHeight}
                        onEdit={onZoneClick}
                        onChange={onZoneChange}
                        resolveDay={resolveDay}
                    />
                ))}
            </Box>

            {/* Task column. */}
            <Box
                data-testid="day-column-content"
                sx={{ position: 'relative', flex: 1, cursor: 'copy' }}
                onMouseDown={onSurfaceDown}
                onMouseUp={onSurfaceUp}
            >
                {tasks.map((task, index) => (
                    <WeekViewTask
                        key={task.taskId ?? index}
                        task={task}
                        columnHeight={columnHeight}
                        actions={actions}
                        onEdit={onTaskEdit}
                        onChange={onTaskChange}
                        resolveDay={resolveDay}
                    />
                ))}
            </Box>
        </Box>
    );
};
