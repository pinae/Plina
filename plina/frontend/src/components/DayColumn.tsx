import React, { useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { WeekViewTask, type ViewTask } from './WeekViewTask';

interface DayColumnProps {
    date: Date;
    tasks: ViewTask[];
    currentTime: Date | null;
    onCreateTask: (start: Date, duration: number) => void;
    columnHeight: number;
}

export const DayColumn: React.FC<DayColumnProps> = ({ date, tasks, currentTime, onCreateTask, columnHeight }) => {
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

        const durationRaw = endMin - startMin;

        // If it's a click (very small movement), default to 1h
        // Threshold: 10 minutes? Or just 0 check?
        // User request: "Single Clicks inside the DayColumn also create a WeekViewTask but with a duration of one hour"
        // "Drag and drop ... duration determined by height of press and release"

        let roundedStartMin = Math.round(startMin / 15) * 15;
        let duration = 60;

        if (durationRaw > 15) {
            // It's a drag
            // Also round start and duration?
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
            {/* Header */}
            <Box sx={{ p: 2, textAlign: 'center', borderBottom: '1px solid #333' }}>
                <Typography variant="subtitle2" sx={{ color: '#aaa', fontWeight: 'bold' }}>
                    {date.toLocaleDateString('de-DE', { weekday: 'short' }).toUpperCase()}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 'normal' }}>
                    {date.getDate().toString().padStart(2, '0')}
                </Typography>
            </Box>

            {/* Content */}
            <Box
                data-testid="day-column-content"
                ref={contentRef}
                sx={{ position: 'relative', height: columnHeight, flexGrow: 1, cursor: 'pointer' }}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
            >
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
                    <Box key={index} onClick={(e) => e.stopPropagation()}>
                        <WeekViewTask task={task} columnHeight={columnHeight} />
                    </Box>
                ))}
            </Box>
        </Box>
    );
};
