import React from 'react';
import { Box, Typography } from '@mui/material';

import { timeScaleLabels } from '../../utils/timeScale.ts';
import { minutesToPixels } from '../../utils/weekDrag.ts';

/** Width of the time scale left of the Week view's first day column. */
export const TIME_SCALE_WIDTH = 44;

interface TimeScaleProps {
    /** Height of the day columns: the whole day, 00:00 at the top. */
    columnHeight: number;
}

/**
 * The times of day next to the Week view's leftmost column.  As many labels
 * as fit without crowding (utils/timeScale.ts), each centred on the line of
 * its time with a short tick towards the columns.  It sticks to the left
 * edge, so the times stay visible when the week scrolls sideways.
 */
export const TimeScale: React.FC<TimeScaleProps> = ({ columnHeight }) => (
    <Box
        data-testid="time-scale"
        aria-hidden
        style={{ height: columnHeight }}
        sx={{
            position: 'sticky', left: 0, zIndex: 2, flexShrink: 0,
            width: TIME_SCALE_WIDTH, backgroundColor: '#1e1e1e', borderRight: '1px solid #333',
        }}
    >
        {timeScaleLabels(columnHeight).map(({ minutes, text, fullHour }) => {
            const top = minutesToPixels(minutes, columnHeight);
            return (
                <React.Fragment key={minutes}>
                    <Box sx={{
                        position: 'absolute', right: 0, top, width: fullHour ? 6 : 3,
                        borderTop: '1px solid', borderColor: fullHour ? '#666' : '#444',
                    }} />
                    <Typography
                        data-testid="time-scale-label"
                        variant="caption"
                        style={{ top }}
                        sx={{
                            position: 'absolute', right: 9, transform: 'translateY(-50%)',
                            lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                            color: fullHour ? '#aaa' : '#777',
                        }}
                    >
                        {text}
                    </Typography>
                </React.Fragment>
            );
        })}
    </Box>
);
