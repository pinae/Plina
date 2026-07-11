import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CheckIcon from '@mui/icons-material/Check';

export interface ViewTask {
    title: string;
    startTime: string; // ISO string
    duration: number; // minutes
    color: string;
    manuallySet: boolean;
    description: string;
    tags: string[]; // colors
    continues: boolean;
    /** Backend task id — present when rendered from a real plan (WP-11). */
    taskId?: string;
    isAppointment?: boolean;
    /** Per-task tracking state; falls back to actions.trackingActive. */
    trackingActive?: boolean;
}

export interface TaskActions {
    trackingActive: boolean;
    onTrackStart: (taskId: string) => void;
    onTrackStop: (taskId: string) => void;
    onComplete: (taskId: string) => void;
}

export interface WeekViewTaskProps {
    task: ViewTask;
    columnHeight: number;
    actions?: TaskActions;
}

export const WeekViewTask: React.FC<WeekViewTaskProps> = ({ task, columnHeight, actions }) => {
    // 1. Calculate Positioning
    const date = new Date(task.startTime);
    const minutesSinceMidnight = date.getHours() * 60 + date.getMinutes();
    const dayDurationMinutes = 24 * 60;

    // Calculate top and height relative to columnHeight
    const top = (minutesSinceMidnight / dayDurationMinutes) * columnHeight;
    const height = (task.duration / dayDurationMinutes) * columnHeight;


    // We'll use a style object for the backgroundColor to allow testing.
    // If not manuallySet, we can set opacity or use a computed color.
    // Test expects: expect(box).not.toHaveStyle({ backgroundColor: '#FF0000' }); if false.
    const backgroundColor = task.manuallySet ? task.color : `${task.color}80`; // Simple alpha for pastel if hex

    // 3. Border Logic
    // "Left border is a bar 0.3em wide which displays the color of all tags"
    // We can use a linear gradient if multiple tags, or just a solid color if one.
    const borderBackground = task.tags.length > 0
        ? (task.tags.length === 1 ? task.tags[0] : `linear-gradient(to bottom, ${task.tags.join(', ')})`)
        : 'transparent';

    return (
        <Box
            data-testid="week-view-task"
            draggable={Boolean(task.taskId && !task.isAppointment)}
            onDragStart={event => {
                if (task.taskId) event.dataTransfer.setData('text/plina-task', task.taskId);
            }}
            sx={{
                position: 'absolute',
                top: `${top}px`,
                height: `${height}px`,
                width: 'calc(100% - 1px)', // 1px margin to the right
                left: 0,
                backgroundColor: backgroundColor,
                display: 'flex',
                fontSize: '0.8rem', // Adjust as needed
                borderBottom: task.continues ? '3px double grey' : 'none',
                overflow: 'hidden',
                boxSizing: 'border-box',
                borderRadius: '4px',
            }}
        >
            {/* Left Border */}
            <Box sx={{ width: '0.3em', background: borderBackground, flexShrink: 0 }} />

            {/* Content */}
            <Box sx={{ p: 0.5, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <Typography
                    variant="subtitle2"
                    sx={{
                        fontWeight: 'bold',
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: '2',
                        WebkitBoxOrient: 'vertical',
                    }}
                >
                    {task.title}
                </Typography>
                {actions && task.taskId && !task.isAppointment && (
                    <Box sx={{ display: 'flex', gap: 0.25 }}>
                        {(task.trackingActive ?? actions.trackingActive) ? (
                            <IconButton
                                size="small" aria-label="stop tracking"
                                onClick={() => actions.onTrackStop(task.taskId!)}
                            >
                                <StopIcon fontSize="inherit" />
                            </IconButton>
                        ) : (
                            <IconButton
                                size="small" aria-label="start tracking"
                                onClick={() => actions.onTrackStart(task.taskId!)}
                            >
                                <PlayArrowIcon fontSize="inherit" />
                            </IconButton>
                        )}
                        <IconButton
                            size="small" aria-label="complete"
                            onClick={() => actions.onComplete(task.taskId!)}
                        >
                            <CheckIcon fontSize="inherit" />
                        </IconButton>
                    </Box>
                )}
                <Typography
                    variant="body2"
                    sx={{
                        fontSize: 'inherit',
                        overflow: 'hidden',
                        whiteSpace: 'normal',
                        textOverflow: 'ellipsis',
                        flex: 1, // Fill remaining space
                    }}
                >
                    {task.description}
                </Typography>
            </Box>
        </Box>
    );
};
