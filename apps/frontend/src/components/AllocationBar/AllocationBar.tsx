/**
 * UI-6: the split editor's allocation bar (docs/task-entry-ui.md §4.3):
 * time already spent (dark), explicit parts (solid, in row order), ghost
 * shares (lighter), the unassigned rest (hatched) and — past the estimate —
 * the overflow (red).
 */
import { Box, Tooltip } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

import type { Allocation, Segment } from '../../utils/splitMath.ts';
import { formatDuration, minutesToDurationString } from '../../utils/duration.ts';

const human = (minutes: number) => formatDuration(minutesToDurationString(minutes));

export function AllocationBar({ allocation }: { allocation: Allocation }) {
    const theme = useTheme();
    const total = allocation.segments.reduce((sum, s) => sum + s.minutes, 0) || 1;
    const style = (segment: Segment) => {
        switch (segment.kind) {
            case 'spent': return { bgcolor: theme.palette.grey[700] };
            case 'explicit': return { bgcolor: theme.palette.primary.main };
            case 'ghost': return { bgcolor: alpha(theme.palette.primary.main, 0.45) };
            case 'unassigned': return {
                backgroundImage: `repeating-linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.25)} 0 6px, transparent 6px 12px)`,
            };
            case 'over': return { bgcolor: theme.palette.error.main };
        }
    };
    const describe = (segment: Segment) => ({
        spent: `${human(segment.minutes)} already spent`,
        explicit: `${segment.label || 'Part'}: ${human(segment.minutes)}`,
        ghost: `${segment.label || 'Part'}: ~${human(segment.minutes)} (share of the rest)`,
        unassigned: `${human(segment.minutes)} not assigned yet`,
        over: `${human(segment.minutes)} over the estimate`,
    })[segment.kind];

    return (
        <Box role="img" aria-label="allocation of the estimate" sx={{
            display: 'flex', height: 22, borderRadius: 1, overflow: 'hidden',
            border: 1, borderColor: 'divider',
        }}>
            {allocation.segments.map((segment, index) => (
                <Tooltip key={index} title={describe(segment)}>
                    <Box data-testid={`segment-${segment.kind}`} sx={{
                        ...style(segment), width: `${(segment.minutes / total) * 100}%`,
                        borderRight: index < allocation.segments.length - 1 ? 1 : 0, borderColor: 'background.paper',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                        fontSize: '0.7rem', whiteSpace: 'nowrap', color: 'common.white', px: 0.5,
                    }}>
                        {segment.minutes / total > 0.12 && (segment.kind === 'explicit' || segment.kind === 'ghost'
                            ? `${segment.label} ${segment.kind === 'ghost' ? '~' : ''}${human(segment.minutes)}`
                            : human(segment.minutes))}
                    </Box>
                </Tooltip>
            ))}
        </Box>
    );
}
