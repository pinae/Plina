import React from 'react';
import { Box, Paper, Typography } from '@mui/material';

import type { ViewTask } from '../WeekViewTask/WeekViewTask.tsx';
import { formatDuration, minutesToDurationString } from '../../utils/duration.ts';

const time = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (date: Date) => date.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' });

const kindOf = (task: ViewTask) =>
    task.isAppointment ? 'Appointment' : task.manuallySet ? 'Fixed' : 'Auto-planned';

/** Full details of a Week-view task card — shown on hover when the card is
 *  too small to display everything itself. */
export const TaskHoverCard: React.FC<{ task: ViewTask }> = ({ task }) => {
    const start = new Date(task.startTime);
    const end = new Date(start.getTime() + task.duration * 60000);

    return (
        <Paper
            data-testid="task-hover-card"
            elevation={8}
            sx={{ p: 1.25, maxWidth: 280, borderLeft: `4px solid ${task.color}` }}
        >
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', lineHeight: 1.25, wordBreak: 'break-word' }}>
                {task.title}
            </Typography>
            <Typography data-testid="hover-time" variant="body2" sx={{ mt: 0.5 }}>
                {day(start)} · {time(start)}–{time(end)} ({formatDuration(minutesToDurationString(task.duration))})
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
                {kindOf(task)}
                {task.trackingActive ? ' · tracking in progress' : ''}
            </Typography>
            {task.valid === false && (
                <Typography variant="caption" color="warning.main" component="div">
                    Invalid as planned — it will be re-planned.
                </Typography>
            )}
            {task.continues && (
                <Typography variant="caption" color="text.secondary" component="div">
                    Continues on the next day.
                </Typography>
            )}
            {task.description && (
                <Box sx={{ mt: 0.5 }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {task.description}
                    </Typography>
                </Box>
            )}
        </Paper>
    );
};
