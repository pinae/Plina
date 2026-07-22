import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CheckIcon from '@mui/icons-material/Check';

import { minutesToPixels } from '../../utils/weekDrag.ts';
import { useVerticalDrag } from '../../hooks/useVerticalDrag.ts';

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
    /** Open the edit dialog (plain click on the card body). */
    onEdit?: (taskId: string) => void;
    /** Commit a move or resize: new start time and duration (minutes). */
    onChange?: (taskId: string, start: Date, durationMinutes: number) => void;
    /** Map a pointer clientX to the day it is over (for cross-day moves). */
    resolveDay?: (clientX: number) => Date | null;
}

const RESIZE_HANDLE_PX = 8;

export const WeekViewTask: React.FC<WeekViewTaskProps> = ({ task, columnHeight, actions, onEdit, onChange, resolveDay }) => {
    const date = new Date(task.startTime);
    const startMinutes = date.getHours() * 60 + date.getMinutes();
    // A press on the body detects a click (edit) or a move (needs onChange);
    // the resize handles only appear when the task can actually be changed.
    const canInteract = Boolean(task.taskId && (onEdit || onChange));
    const canResize = Boolean(task.taskId && onChange);

    const { preview, startDrag } = useVerticalDrag({
        startMinutes,
        durationMinutes: task.duration,
        columnHeight,
        onCommit: (result, ctx) => {
            if (!task.taskId || !onChange) return;
            // A horizontal move lands on the day under the pointer; the time
            // comes from the vertical drag. Resize stays on the task's day.
            const day = (ctx.mode === 'move' && resolveDay?.(ctx.clientX)) || date;
            const newStart = new Date(day);
            newStart.setHours(0, result.startMinutes, 0, 0);
            onChange(task.taskId, newStart, result.durationMinutes);
        },
        onClick: () => { if (task.taskId && onEdit) onEdit(task.taskId); },
    });

    const top = minutesToPixels(preview?.startMinutes ?? startMinutes, columnHeight);
    const height = minutesToPixels(preview?.durationMinutes ?? task.duration, columnHeight);

    const backgroundColor = task.manuallySet ? task.color : `${task.color}80`;
    const borderBackground = task.tags.length > 0
        ? (task.tags.length === 1 ? task.tags[0] : `linear-gradient(to bottom, ${task.tags.join(', ')})`)
        : 'transparent';

    return (
        <Box
            data-testid="week-view-task"
            onMouseDown={canInteract ? startDrag('move') : undefined}
            sx={{
                position: 'absolute',
                top: `${top}px`,
                height: `${height}px`,
                width: 'calc(100% - 1px)', // 1px margin to the right
                left: 0,
                backgroundColor: backgroundColor,
                display: 'flex',
                fontSize: '0.8rem',
                borderBottom: task.continues ? '3px double grey' : 'none',
                overflow: 'hidden',
                boxSizing: 'border-box',
                borderRadius: '4px',
                cursor: canResize ? 'grab' : canInteract ? 'pointer' : 'default',
                userSelect: 'none',
            }}
        >
            {/* Top resize handle */}
            {canResize && (
                <Box
                    data-testid="task-resize-top"
                    onMouseDown={startDrag('resize-top')}
                    sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: RESIZE_HANDLE_PX, cursor: 'ns-resize', zIndex: 2 }}
                />
            )}

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
                    <Box
                        sx={{ display: 'flex', gap: 0.25 }}
                        onClick={event => event.stopPropagation()}
                        onMouseDown={event => event.stopPropagation()}
                    >
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
                        flex: 1,
                    }}
                >
                    {task.description}
                </Typography>
            </Box>

            {/* Bottom resize handle */}
            {canResize && (
                <Box
                    data-testid="task-resize-bottom"
                    onMouseDown={startDrag('resize-bottom')}
                    sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: RESIZE_HANDLE_PX, cursor: 'ns-resize', zIndex: 2 }}
                />
            )}
        </Box>
    );
};
