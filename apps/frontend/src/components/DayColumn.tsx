import React, { useRef } from 'react';
import { Box } from '@mui/material';
import { WeekViewTask, type ViewTask, type TaskActions } from './WeekViewTask';
import { dropTimeFromOffset, type DayZone } from '../utils/planToWeek';

interface DayColumnProps {
    date: Date;
    tasks: ViewTask[];
    currentTime: Date | null;
    onCreateTask: (start: Date, duration: number) => void;
    columnHeight: number;
    zones?: DayZone[];
    actions?: TaskActions;
    onDropTask?: (taskId: string, start: Date) => void;
    onZoneClick?: (zone: DayZone) => void;
}

export const DayColumn: React.FC<DayColumnProps> = ({ date, tasks, currentTime, onCreateTask, columnHeight, zones = [], actions, onDropTask, onZoneClick }) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef<number | null>(null);

    const getMinutesFromClientY = (clientY: number) => {
        if (!contentRef.current) return 0;
        const rect = contentRef.current.getBoundingClientRect();
        const y = clientY - rect.top;
        return (y / columnHeight) * 24 * 60;
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        // Only start drag on left click
        if (e.button !== 0) return;
        dragStartRef.current = getMinutesFromClientY(e.clientY);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (dragStartRef.current === null) return;

        const endMinutes = getMinutesFromClientY(e.clientY);
        const startMinutesRaw = dragStartRef.current;
        dragStartRef.current = null;

        let startMin = Math.min(startMinutesRaw, endMinutes);
        let endMin = Math.max(startMinutesRaw, endMinutes);

        // Rounding logic matches previous implementation
        const durationRaw = endMin - startMin;

        let roundedStartMin = Math.round(startMin / 15) * 15;
        let duration = 60; // Default click duration

        if (durationRaw > 15) {
            // It's a drag
            roundedStartMin = Math.round(startMin / 15) * 15;
            let roundedEndMin = Math.round(endMin / 15) * 15;
            duration = roundedEndMin - roundedStartMin;
            if (duration === 0) duration = 15; // Minimum drag
        }

        const start = new Date(date);
        start.setHours(0, roundedStartMin, 0, 0);

        onCreateTask(start, duration);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid #333' }}>
            {/* Content (Header responsibility moved to WeekView) */}
            <Box
                data-testid="day-column-content"
                ref={contentRef}
                sx={{ position: 'relative', height: columnHeight, flexGrow: 1, cursor: 'pointer' }}
                onDragOver={event => { if (onDropTask) event.preventDefault(); }}
                onDrop={event => {
                    if (!onDropTask) return;
                    const taskId = event.dataTransfer.getData('text/plina-task');
                    if (!taskId) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    onDropTask(taskId, dropTimeFromOffset(date, event.clientY - bounds.top, columnHeight));
                }}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
            >
                {/* Bucket zones (background, behind tasks) */}
                {zones.map(zone => (
                    <Box
                        key={zone.id}
                        data-testid="bucket-zone"
                        onClick={event => {
                            if (!onZoneClick) return;
                            event.stopPropagation();
                            onZoneClick(zone);
                        }}
                        sx={{
                            position: 'absolute',
                            top: `${(zone.topMinutes / 1440) * columnHeight}px`,
                            height: `${(zone.heightMinutes / 1440) * columnHeight}px`,
                            width: '100%',
                            backgroundColor: `${zone.color}22`,
                            borderLeft: `3px solid ${zone.color}`,
                            boxSizing: 'border-box',
                            zIndex: 0,
                        }}
                    >
                        <Box component="span" sx={{ fontSize: '0.65rem', color: zone.color, pl: 0.5 }}>
                            {zone.label}
                        </Box>
                    </Box>
                ))}

                {/* Hour Dividers */}
                {Array.from({ length: 24 }).map((_, i) => (
                    <Box
                        key={i}
                        data-testid="hour-divider"
                        sx={{
                            position: 'absolute',
                            top: `${(i / 24) * 100}%`,
                            width: '100%',
                            borderTop: '1px solid rgba(255,255,255,0.05)'
                        }}
                    />
                ))}

                {/* Current Time Line */}
                {currentTime && (
                    <Box
                        data-testid="current-time-line"
                        sx={{
                            position: 'absolute',
                            top: `${(currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60) * columnHeight}px`,
                            width: '100%',
                            borderTop: '2px solid white',
                            zIndex: 10
                        }}
                    />
                )}

                {/* Tasks */}
                {tasks.map((task, index) => (
                    <Box
                        key={index}
                        // Stop propagation for both click and mousedown/up to prevent task creation when interacting with existing task
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseUp={(e) => e.stopPropagation()}
                    >
                        <WeekViewTask task={task} columnHeight={columnHeight} actions={actions} />
                    </Box>
                ))}
            </Box>
        </Box>
    );
};
