/**
 * "Nice! What next?" — shown after completing a task when the plan forks
 * (the response carries alternatives). Used by the Week view and the header
 * tracker (UI-5). When parents completed along (UI-8), their Undo lives here
 * instead of in the snackbar, which the modal would make unreachable.
 */
import { Box, Dialog, DialogContent, DialogTitle } from '@mui/material';

import { CompletedTooAlert } from '../CompletionSnackbar/CompletionSnackbar.tsx';
import { PlanChooser } from '../PlanChooser/PlanChooser.tsx';
import { useAcceptPlan } from '../../queries.tsx';
import type { PlanAlternative } from '../../types.ts';

export interface WhatNextDialogProps {
    /** Null = closed. */
    alternatives: PlanAlternative[] | null;
    /** ``auto_completed`` of the same complete response. */
    autoCompleted?: { id: string; header: string }[] | null;
    onClose: () => void;
}

export function WhatNextDialog({ alternatives, autoCompleted, onClose }: WhatNextDialogProps) {
    const accept = useAcceptPlan();
    return (
        <Dialog open={alternatives !== null} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>Nice! What next?</DialogTitle>
            <DialogContent>
                {autoCompleted?.length ? (
                    <Box sx={{ mb: 2 }}>
                        {/* The alternatives don't know the reopened tasks: close. */}
                        <CompletedTooAlert autoCompleted={autoCompleted} onUndone={onClose} variant="outlined" />
                    </Box>
                ) : null}
                {alternatives && (
                    <PlanChooser
                        alternatives={alternatives}
                        accepting={accept.isPending}
                        onAccept={planId => accept.mutate(planId, { onSuccess: onClose })}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
