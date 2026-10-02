import { useEffect } from 'react';
import { Box, Button } from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';

export const REPLAN_COUNTDOWN_MS = 5000;

export interface PlanMyWeekButtonProps {
    /** The plan is obsolete (a manual edit invalidated an auto task). */
    dirty: boolean;
    /** A drag is in progress — the countdown waits until it finishes. */
    dragging: boolean;
    /** Fired when the countdown elapses (auto re-plan). */
    onTrigger: () => void;
    /** Fired when the user clicks the button (immediate re-plan). */
    onClick: () => void;
    /** Phones (UI-9): icon only, the name stays for screen readers. */
    compact?: boolean;
}

/**
 * "Plan my week". When the plan goes obsolete the button brightens; once the
 * current drag ends a 5s countdown runs, shown as a receding progress bar, and
 * then triggers a plan event. Starting another drag postpones it — the
 * countdown restarts after that drag finishes.
 */
export function PlanMyWeekButton({ dirty, dragging, onTrigger, onClick, compact = false }: PlanMyWeekButtonProps) {
    const counting = dirty && !dragging;

    // The countdown runs only while counting; the progress overlay remounts
    // (restarting its animation) whenever counting resumes after a drag.
    useEffect(() => {
        if (!counting) return;
        const timer = setTimeout(onTrigger, REPLAN_COUNTDOWN_MS);
        return () => clearTimeout(timer);
    }, [counting, onTrigger]);

    return (
        <Button
            variant="contained"
            size="small"
            color={dirty ? 'warning' : 'primary'}
            startIcon={compact ? undefined : <EventAvailableIcon />}
            aria-label={compact ? 'Plan my week' : undefined}
            onClick={onClick}
            sx={{ mr: compact ? 0 : 1, flexShrink: 0, position: 'relative', overflow: 'hidden', ...(compact && { minWidth: 0, px: 1 }) }}
            data-dirty={dirty || undefined}
        >
            {counting && (
                <Box
                    data-testid="replan-countdown"
                    sx={{
                        position: 'absolute', inset: 0,
                        backgroundColor: 'rgba(255, 255, 255, 0.45)',
                        transformOrigin: 'left', pointerEvents: 'none',
                        animation: 'plina-recede 5s linear forwards',
                        '@keyframes plina-recede': {
                            from: { transform: 'scaleX(1)' },
                            to: { transform: 'scaleX(0)' },
                        },
                    }}
                />
            )}
            {compact
                ? <EventAvailableIcon fontSize="small" sx={{ position: 'relative' }} />
                : <Box component="span" sx={{ position: 'relative' }}>Plan my week</Box>}
        </Button>
    );
}
