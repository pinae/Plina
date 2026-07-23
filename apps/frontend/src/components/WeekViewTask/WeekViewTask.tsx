import React, { useState } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CheckIcon from '@mui/icons-material/Check';

import { minutesToPixels, type DragMode } from '../../utils/weekDrag.ts';
import { useVerticalDrag } from '../../hooks/useVerticalDrag.ts';

/** Live state of an in-progress drag, used to move the dragged appointment as a
 *  floating card and to fade/shrink the tasks the edit would overlap. */
export interface ActiveDrag {
    taskId: string;
    mode: DragMode;
    start: Date;
    durationMinutes: number;
    color: string;
    title: string;
    isAppointment: boolean;
    /** Which half of the column the cursor is in — an overlap shrinks to the
     *  other half. */
    cursorHalf: 'left' | 'right';
}

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
    /** False when an auto-planned task can no longer exist as planned (an edit
     *  overlapped it). Shown at very low opacity until the plan is renewed. */
    valid?: boolean;
    /** Transient: an overlapped appointment shrinks to half the column, on this
     *  side, while an appointment is dragged over it. */
    shrinkSide?: 'left' | 'right' | null;
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
    /** Which half of the day column the pointer x is in. */
    resolveCursorHalf?: (clientX: number) => 'left' | 'right';
    /** Report the live drag (null clears it) for the drag layer + fading. */
    onDragChange?: (drag: ActiveDrag | null) => void;
}

const RESIZE_HANDLE_PX = 10;

export const WeekViewTask: React.FC<WeekViewTaskProps> = ({ task, columnHeight, actions, onEdit, onChange, resolveDay, resolveCursorHalf, onDragChange }) => {
    const date = new Date(task.startTime);
    const startMinutes = date.getHours() * 60 + date.getMinutes();
    const [dragMode, setDragMode] = useState<DragMode | null>(null);

    const isAppointment = Boolean(task.isAppointment);
    const isAuto = !task.manuallySet;
    // Only appointments move as a whole; every other task can be resized from
    // the bottom to change its duration. Any task can be clicked to edit.
    const canMove = Boolean(task.taskId && onChange && isAppointment);
    const canResize = Boolean(task.taskId && onChange && !isAppointment);
    const canEdit = Boolean(task.taskId && onEdit);

    const dayFor = (ctx: { mode: DragMode; clientX: number }) =>
        (ctx.mode === 'move' && resolveDay?.(ctx.clientX)) || date;

    const { preview, startDrag } = useVerticalDrag({
        startMinutes,
        durationMinutes: task.duration,
        columnHeight,
        onCommit: (result, ctx) => {
            if (!task.taskId || !onChange) return;
            const newStart = new Date(dayFor(ctx));
            newStart.setHours(0, result.startMinutes, 0, 0);
            onChange(task.taskId, newStart, result.durationMinutes);
        },
        onPreview: (result, ctx) => {
            if (!task.taskId || !onDragChange) return;
            setDragMode(ctx.mode);
            const start = new Date(dayFor(ctx));
            start.setHours(0, result.startMinutes, 0, 0);
            onDragChange({
                taskId: task.taskId, mode: ctx.mode, start, durationMinutes: result.durationMinutes,
                color: task.color, title: task.title, isAppointment,
                cursorHalf: resolveCursorHalf?.(ctx.clientX) ?? 'left',
            });
        },
        onActiveChange: active => {
            if (!active) { setDragMode(null); onDragChange?.(null); }
        },
        onClick: () => { if (task.taskId && onEdit) onEdit(task.taskId); },
    });

    const moving = dragMode === 'move';
    const resizing = dragMode === 'resize-bottom';
    const height = minutesToPixels(resizing ? (preview?.durationMinutes ?? task.duration) : task.duration, columnHeight);
    const top = minutesToPixels(startMinutes, columnHeight);

    const backgroundColor = task.manuallySet ? task.color : `${task.color}80`;
    const borderBackground = task.tags.length > 0
        ? (task.tags.length === 1 ? task.tags[0] : `linear-gradient(to bottom, ${task.tags.join(', ')})`)
        : 'transparent';

    // An overlapped appointment shrinks to half the column, away from the cursor.
    const shrunk = task.shrinkSide === 'left' || task.shrinkSide === 'right';
    const width = shrunk ? '50%' : 'calc(100% - 1px)';
    const left = task.shrinkSide === 'right' ? '50%' : 0;

    return (
        <Box
            data-testid="week-view-task"
            onMouseDown={canMove ? startDrag('move') : undefined}
            onClick={!canMove && canEdit ? () => onEdit!(task.taskId!) : undefined}
            sx={{
                position: 'absolute',
                top: `${top}px`,
                height: `${height}px`,
                width,
                left,
                backgroundColor: backgroundColor,
                display: 'flex',
                fontSize: '0.8rem',
                // The dragged appointment hides while its floating card leads.
                visibility: moving ? 'hidden' : 'visible',
                // Auto-planned tasks read as tentative: 80% opacity + dashed
                // outline, dropping to 30% when invalidated. Appointments and
                // fixed tasks are solid at full opacity.
                opacity: isAuto ? (task.valid === false ? 0.3 : 0.8) : 1,
                border: isAuto
                    ? '1px dashed rgba(255, 255, 255, 0.6)'
                    : '1px solid rgba(255, 255, 255, 0.4)',
                borderBottom: task.continues ? '3px double grey' : undefined,
                overflow: 'hidden',
                boxSizing: 'border-box',
                borderRadius: '4px',
                cursor: canMove ? 'grab' : canEdit ? 'pointer' : 'default',
                userSelect: 'none',
                transition: 'width 0.15s ease, left 0.15s ease',
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

            {/* Bottom resize handle (duration) — non-appointments only. */}
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
