import React from 'react';
import { Box } from '@mui/material';

import type { DayZone } from '../../utils/planToWeek.ts';
import { minutesToPixels } from '../../utils/weekDrag.ts';
import { useVerticalDrag } from '../../hooks/useVerticalDrag.ts';

export interface BucketBlockProps {
    zone: DayZone;
    /** Pixel height of a full day at the current zoom. */
    columnHeight: number;
    /** Open the edit dialog (plain click). */
    onEdit?: (zone: DayZone) => void;
    /** Commit a move/resize: the new start (full Date) and duration (minutes). */
    onChange?: (zone: DayZone, start: Date, durationMinutes: number) => void;
    /** Map a pointer clientX to the day it is over (for cross-day moves). */
    resolveDay?: (clientX: number) => Date | null;
}

const RESIZE_HANDLE_PX = 8;

/** A single bucket occurrence in a day's bucket column — click to edit, drag
 *  the body to move it (across days too), drag the top/bottom edge to change
 *  its duration. */
export const BucketBlock: React.FC<BucketBlockProps> = ({ zone, columnHeight, onEdit, onChange, resolveDay }) => {
    const { preview, startDrag } = useVerticalDrag({
        startMinutes: zone.topMinutes,
        durationMinutes: zone.heightMinutes,
        columnHeight,
        onClick: () => onEdit?.(zone),
        onCommit: (result, ctx) => {
            const day = (ctx.mode === 'move' && resolveDay?.(ctx.clientX)) || zone.start;
            const start = new Date(day);
            start.setHours(0, result.startMinutes, 0, 0);
            onChange?.(zone, start, result.durationMinutes);
        },
    });

    const top = minutesToPixels(preview?.startMinutes ?? zone.topMinutes, columnHeight);
    const height = minutesToPixels(preview?.durationMinutes ?? zone.heightMinutes, columnHeight);

    return (
        <Box
            data-testid="bucket-zone"
            onMouseDown={startDrag('move')}
            sx={{
                position: 'absolute',
                top: `${top}px`,
                height: `${height}px`,
                width: '100%',
                backgroundColor: `${zone.color}33`,
                borderLeft: `3px solid ${zone.color}`,
                boxSizing: 'border-box',
                cursor: 'grab',
                userSelect: 'none',
                overflow: 'hidden',
                zIndex: 1,
            }}
        >
            <Box
                data-testid="bucket-resize-top"
                onMouseDown={startDrag('resize-top')}
                sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: RESIZE_HANDLE_PX, cursor: 'ns-resize' }}
            />
            <Box component="span" sx={{ fontSize: '0.6rem', color: zone.color, pl: 0.5, pointerEvents: 'none' }}>
                {zone.label}
            </Box>
            <Box
                data-testid="bucket-resize-bottom"
                onMouseDown={startDrag('resize-bottom')}
                sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: RESIZE_HANDLE_PX, cursor: 'ns-resize' }}
            />
        </Box>
    );
};
