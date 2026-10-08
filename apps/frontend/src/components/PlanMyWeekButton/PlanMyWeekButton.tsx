import { Box, Button } from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';

export interface PlanMyWeekButtonProps {
    /** Opens the plan chooser: fresh alternatives to pick from. */
    onClick: () => void;
    /** Phones (UI-9): icon only, the name stays for screen readers. */
    compact?: boolean;
}

/**
 * "Plan my week": fresh plan alternatives to choose from. Only a click plans
 * (README: Planning light) — between plans, the Week view fits what happens
 * into the accepted one.
 */
export function PlanMyWeekButton({ onClick, compact = false }: PlanMyWeekButtonProps) {
    return (
        <Button
            variant="contained"
            size="small"
            startIcon={compact ? undefined : <EventAvailableIcon />}
            aria-label={compact ? 'Plan my week' : undefined}
            onClick={onClick}
            sx={{ mr: compact ? 0 : 1, flexShrink: 0, ...(compact && { minWidth: 0, px: 1 }) }}
        >
            {compact
                ? <EventAvailableIcon fontSize="small" />
                : <Box component="span">Plan my week</Box>}
        </Button>
    );
}
