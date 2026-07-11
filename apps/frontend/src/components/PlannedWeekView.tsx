import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Snackbar, TextField,
} from '@mui/material';

import api from '../api';
import { useAcceptPlan, useCompleteTask, usePlan, useStartTracking, useStopTracking, useTasks, queryKeys } from '../queries';
import { usePlacement } from '../hooks/usePlacement';
import { bucketsToZones, firstFreeDay, planToViewTasks, type DayZone } from '../utils/planToWeek';
import type { PlanAlternative } from '../types';
import { WeekView } from './WeekView';
import { PlanChooser } from './PlanChooser';
import { FeasibilityBanner } from './FeasibilityBanner';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import { useQueryClient } from '@tanstack/react-query';

function BucketEditDialog({ zone, onClose }: { zone: DayZone; onClose: () => void }) {
    const client = useQueryClient();
    const toLocalInput = (date: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
            + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const [start, setStart] = useState(toLocalInput(zone.start));
    const [hours, setHours] = useState(
        String((zone.end.getTime() - zone.start.getTime()) / 3600000),
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        setSaving(true);
        setError(null);
        const payload = {
            start_date: new Date(start).toISOString(),
            duration: `${String(Math.floor(Number(hours))).padStart(2, '0')}:${String(Math.round((Number(hours) % 1) * 60)).padStart(2, '0')}:00`,
        };
        try {
            if (zone.persisted) {
                await api.patch(`timebuckets/${zone.id}/`, payload);
            } else {
                // A8: editing a generated occurrence materializes it under
                // its pre-assigned id.
                await api.post('timebuckets/', {
                    id: zone.id, type_id: zone.typeId, ...payload,
                });
            }
            await client.invalidateQueries({ queryKey: queryKeys.plan });
            onClose();
        } catch {
            setError('Could not save the bucket.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Edit bucket — {zone.label}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                    label="Start" type="datetime-local" value={start} margin="dense"
                    onChange={event => setStart(event.target.value)}
                />
                <TextField
                    label="Duration (hours)" type="number" value={hours}
                    onChange={event => setHours(event.target.value)}
                />
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={saving}>Save</Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * WP-11: the Week view on the real (accepted) plan.
 *
 * Fluid items render pastel, anchored ones solid; buckets are background
 * zones (click to edit/materialize per A8); dropping a task PATCHes
 * start_date+is_fixed — the server enforces predecessor ordering and its
 * message surfaces as a snackbar; ▶/⏹/✓ drive tracking and completion,
 * with the WP-10 chooser opening when completion returns choices.
 */
export default function PlannedWeekView({ initialDate }: { initialDate?: Date }) {
    const plan = usePlan();
    const tasks = useTasks();
    const placement = usePlacement();
    const startTracking = useStartTracking();
    const stopTracking = useStopTracking();
    const complete = useCompleteTask();
    const accept = useAcceptPlan();
    const [choices, setChoices] = useState<PlanAlternative[] | null>(null);
    const [editingZone, setEditingZone] = useState<DayZone | null>(null);
    const [actionToast, setActionToast] = useState<string | null>(null);
    const [weekAnchor, setWeekAnchor] = useState<Date | undefined>(initialDate);

    const viewTasks = useMemo(
        () => (plan.data ? planToViewTasks(plan.data) : []),
        [plan.data],
    );
    const zones = useMemo(
        () => (plan.data ? bucketsToZones(plan.data) : []),
        [plan.data],
    );
    const freeDay = useMemo(
        () => (plan.data ? firstFreeDay(plan.data, new Date()) : null),
        [plan.data],
    );
    const trackedTaskId = useMemo(
        () => tasks.data?.find(task => task.active_tracking_start !== null)?.id ?? null,
        [tasks.data],
    );

    if (plan.isPending) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }
    if (plan.isError) {
        return <Alert severity="error">Could not load the plan.</Alert>;
    }

    const surface = (error: unknown, fallback: string) => {
        const detail = (error as { response?: { data?: { detail?: string } } })
            ?.response?.data?.detail;
        setActionToast(detail ?? fallback);
    };

    const actions = {
        trackingActive: false,
        onTrackStart: (taskId: string) =>
            startTracking.mutate(taskId, {
                onError: error => surface(error, 'Could not start tracking.'),
            }),
        onTrackStop: (taskId: string) =>
            stopTracking.mutate(taskId, {
                onError: error => surface(error, 'Could not stop tracking.'),
            }),
        onComplete: (taskId: string) =>
            complete.mutate(taskId, {
                onSuccess: data => {
                    if (data.alternatives.length > 0) setChoices(data.alternatives);
                },
                onError: error => surface(error, 'Could not complete the task.'),
            }),
    };

    const toast = placement.toast ?? actionToast;
    const clearToast = () => {
        placement.clearToast();
        setActionToast(null);
    };

    return (
        <>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 1 }}>
                <Box sx={{ flexGrow: 1 }}>
                    <FeasibilityBanner warnings={plan.data?.warnings ?? []} />
                </Box>
                <Button
                    size="small" variant="outlined" startIcon={<SkipNextIcon />}
                    disabled={freeDay === null}
                    onClick={() => freeDay && setWeekAnchor(freeDay)}
                >
                    Jump to first free day
                </Button>
            </Box>
            <WeekView
                key={weekAnchor?.toISOString() ?? 'initial'}
                tasks={viewTasks.map(task => ({
                    ...task,
                    // The card of the actively tracked task offers ⏹.
                    trackingActive: task.taskId === trackedTaskId,
                }))}
                initialDate={weekAnchor}
                zones={zones}
                actions={actions}
                onDropTask={placement.placeTask}
                onZoneClick={setEditingZone}
            />
            {editingZone && (
                <BucketEditDialog zone={editingZone} onClose={() => setEditingZone(null)} />
            )}
            <Dialog open={choices !== null} onClose={() => setChoices(null)} maxWidth="lg" fullWidth>
                <DialogTitle>Nice! What next?</DialogTitle>
                <DialogContent>
                    {choices && (
                        <PlanChooser
                            alternatives={choices}
                            accepting={accept.isPending}
                            onAccept={planId =>
                                accept.mutate(planId, { onSuccess: () => setChoices(null) })}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <Snackbar
                open={toast !== null} autoHideDuration={6000} onClose={clearToast}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="error" variant="filled" onClose={clearToast}>
                    {toast}
                </Alert>
            </Snackbar>
        </>
    );
}
