/**
 * UI-8: after completing the last open subtask, its parents complete by
 * themselves (UI-2). This snackbar names the topmost of them and offers
 * Undo, which reopens the lowest one — and with it its completed ancestors
 * (docs/task-entry-ui.md §4.5).
 */
import { Alert, Button, Snackbar } from '@mui/material';
import type { AlertProps } from '@mui/material';

import { useReopenTask } from '../../queries.tsx';

type AutoCompleted = { id: string; header: string }[];

export interface CompletedTooAlertProps {
    /** ``auto_completed`` of the complete response (bottom-up, non-empty). */
    autoCompleted: AutoCompleted;
    /** Called once the undo request has settled. */
    onUndone: () => void;
    onClose?: () => void;
    variant?: AlertProps['variant'];
}

/** “T250” completed too · Undo — also shown inside the “What next?” dialog,
 *  whose modal would hide the snackbar from keyboard and screen readers. */
export function CompletedTooAlert({ autoCompleted, onUndone, onClose, variant = 'filled' }: CompletedTooAlertProps) {
    const reopen = useReopenTask();
    const lowest = autoCompleted[0];
    const topmost = autoCompleted[autoCompleted.length - 1];
    return (
        <Alert severity="success" variant={variant} onClose={onClose}
            action={
                <Button color="inherit" size="small" disabled={reopen.isPending}
                    onClick={() => reopen.mutate(lowest.id, { onSettled: onUndone })}>
                    Undo
                </Button>
            }>
            “{topmost.header}” completed too
        </Alert>
    );
}

export interface CompletionSnackbarProps {
    /** ``auto_completed`` of the complete response (bottom-up); null = hidden. */
    autoCompleted: AutoCompleted | null;
    onClose: () => void;
}

export function CompletionSnackbar({ autoCompleted, onClose }: CompletionSnackbarProps) {
    return (
        <Snackbar open={Boolean(autoCompleted?.length)} autoHideDuration={10000} onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
            {/* Snackbar needs a child while closing; keep the last content. */}
            <div>
                {autoCompleted?.length ? (
                    <CompletedTooAlert autoCompleted={autoCompleted} onUndone={onClose} onClose={onClose} />
                ) : null}
            </div>
        </Snackbar>
    );
}
