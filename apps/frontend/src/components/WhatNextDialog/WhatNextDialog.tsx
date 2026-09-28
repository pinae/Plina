/**
 * "Nice! What next?" — shown after completing a task when the plan forks
 * (the response carries alternatives). Used by the Week view and the header
 * tracker (UI-5).
 */
import { Dialog, DialogContent, DialogTitle } from '@mui/material';

import { PlanChooser } from '../PlanChooser/PlanChooser.tsx';
import { useAcceptPlan } from '../../queries.tsx';
import type { PlanAlternative } from '../../types.ts';

export interface WhatNextDialogProps {
    /** Null = closed. */
    alternatives: PlanAlternative[] | null;
    onClose: () => void;
}

export function WhatNextDialog({ alternatives, onClose }: WhatNextDialogProps) {
    const accept = useAcceptPlan();
    return (
        <Dialog open={alternatives !== null} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>Nice! What next?</DialogTitle>
            <DialogContent>
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
