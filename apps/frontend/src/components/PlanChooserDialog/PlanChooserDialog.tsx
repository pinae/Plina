import { useEffect, useRef } from 'react';
import {
    Alert, Box, CircularProgress, Dialog, DialogContent, DialogTitle,
} from '@mui/material';

import { useAcceptPlan, useComputeAlternatives } from '../../queries.tsx';
import { PlanChooser } from '../PlanChooser/PlanChooser.tsx';
import type { PlanAlternative } from '../../types.ts';

const hasScheduledWork = (alternative: PlanAlternative) =>
    alternative.appointments.length > 0
    || alternative.buckets.some(bucket => bucket.items.length > 0);

interface PlanChooserDialogProps {
    open: boolean;
    onClose: () => void;
    /** Called after a plan was accepted — the app navigates to the Week view. */
    onAccepted: () => void;
}

/**
 * WP-10: "Plan my week".  Opening computes and stores fresh candidates;
 * exactly one alternative auto-accepts silently (no fake choice, per WP-4);
 * two or more render as cards.
 */
export function PlanChooserDialog({ open, onClose, onAccepted }: PlanChooserDialogProps) {
    const compute = useComputeAlternatives();
    const accept = useAcceptPlan();
    const computedFor = useRef(false);
    const autoAccepted = useRef(false);
    // Synchronous guard: `accept.isPending` only flips after a re-render, so a
    // double click in the same tick would fire two requests without this ref.
    const acceptInFlight = useRef(false);

    useEffect(() => {
        if (open && !computedFor.current) {
            computedFor.current = true;
            autoAccepted.current = false;
            compute.mutate();
        }
        if (!open) {
            computedFor.current = false;
            compute.reset();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const alternatives = compute.data?.alternatives ?? [];

    const acceptPlan = (planId: string) => {
        if (acceptInFlight.current) return;
        acceptInFlight.current = true;
        accept.mutate(planId, {
            onSuccess: () => {
                onAccepted();
                onClose();
            },
            onSettled: () => {
                acceptInFlight.current = false;
            },
        });
    };

    const nothingSchedulable =
        compute.isSuccess && alternatives.length > 0
        && alternatives.every(alternative => !hasScheduledWork(alternative));

    // Single valid ordering: accept it without showing a fake choice.
    // Never auto-accept an *empty* plan though — that would silently do
    // nothing (the no-buckets trap); explain the situation instead.
    useEffect(() => {
        if (
            compute.isSuccess && alternatives.length === 1
            && hasScheduledWork(alternatives[0])
            && alternatives[0].id && !autoAccepted.current
        ) {
            autoAccepted.current = true;
            acceptPlan(alternatives[0].id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compute.isSuccess, alternatives]);

    const showCards = compute.isSuccess && alternatives.length > 1 && !nothingSchedulable;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>How do you want to plan?</DialogTitle>
            <DialogContent>
                {(compute.isPending || (compute.isSuccess && alternatives.length === 1 && !nothingSchedulable)) && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                        <CircularProgress />
                    </Box>
                )}
                {compute.isError && (
                    <Alert severity="error">Could not compute plan alternatives.</Alert>
                )}
                {compute.isSuccess && alternatives.length === 0 && (
                    <Alert severity="info">
                        Nothing to plan — add tasks and time buckets first.
                    </Alert>
                )}
                {nothingSchedulable && (
                    <Alert severity="warning">
                        Your tasks could not be scheduled because there is no
                        available time: create recurring time buckets (or place
                        some by hand) so Plina has somewhere to put your work.
                        Unscheduled: {
                            [...new Set(
                                alternatives.flatMap(a => a.warnings)
                                    .filter(w => w.kind === 'unplanned_within_horizon')
                                    .map(w => w.header),
                            )].join(', ')
                        }
                    </Alert>
                )}
                {showCards && (
                    <PlanChooser
                        alternatives={alternatives}
                        onAccept={acceptPlan}
                        accepting={accept.isPending}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
