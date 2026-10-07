import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Snackbar, TextField, Tooltip,
} from '@mui/material';
import CallMergeIcon from '@mui/icons-material/CallMerge';

import api from '../../api.ts';
import {
    useBucketTypes, useCompleteTask, useMarkers, useSettings, usePlan, useStartTracking, useStopTracking, useTasks,
    queryKeys,
} from '../../queries.tsx';
import type { Task } from '../../types.ts';
import { useDependencyDrawing } from '../../hooks/useDependencyDrawing.ts';
import { DependencyDrawLayer } from '../DependencyDrawLayer/DependencyDrawLayer.tsx';
import { MergeDialog } from '../MergeDialog/MergeDialog.tsx';
import { keptOf } from '../../utils/merge.ts';
import { MarkerDialog } from '../MarkerDialog/MarkerDialog.tsx';
import { BucketTypeFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';
import { usePlacement } from '../../hooks/usePlacement.ts';
import { bucketsToZones, firstFreeDay, overlapsAutoTask, planToViewTasks, type DayZone } from '../../utils/planToWeek.ts';
import { minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import { clockMinutes } from '../../utils/timeScale.ts';
import { useNow } from '../../hooks/useNow.ts';
import type { PlanAlternative } from '../../types.ts';
import type { ActiveDrag } from '../WeekViewTask/WeekViewTask.tsx';
import { WeekView, type DayMark } from '../WeekView/WeekView.tsx';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';
import { WhatNextDialog } from '../WhatNextDialog/WhatNextDialog.tsx';
import { SplitEditor } from '../SplitEditor/SplitEditor.tsx';
import { CompletionSnackbar } from '../CompletionSnackbar/CompletionSnackbar.tsx';
import { FeasibilityBanner } from '../FeasibilityBanner/FeasibilityBanner.tsx';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

/** Persist a bucket placement.  A persisted bucket is patched in place; a
 *  generated occurrence is materialized (A8) and records the original slot it
 *  replaces via `origin_date`, so the recurrence rule no longer regenerates a
 *  duplicate there when it is moved/resized. */
async function saveBucket(
    client: QueryClient, zone: DayZone, startISO: string, duration: string,
) {
    if (zone.persisted) {
        await api.patch(`timebuckets/${zone.id}/`, { start_date: startISO, duration });
    } else {
        await api.post('timebuckets/', {
            id: zone.id, type_id: zone.typeId, start_date: startISO, duration,
            origin_date: zone.start.toISOString(),
        });
    }
    await client.invalidateQueries({ queryKey: queryKeys.plan });
}

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
        try {
            await saveBucket(
                client, zone, new Date(start).toISOString(),
                minutesToDurationString(Number(hours) * 60),
            );
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
 *
 * Calendar (README: Calendar): markers and special buckets in the lane below
 * the day headers (a click on a free lane makes a marker); "Merge tasks":
 * drag from one card onto another to merge the two tasks.
 */
interface PlannedWeekViewProps {
    initialDate?: Date;
    /** True while a task is being dragged (gates the re-plan countdown). */
    onDraggingChange?: (dragging: boolean) => void;
    /** A manual edit invalidated an auto task — the plan is now obsolete. */
    onPlanDirty?: () => void;
}

/** A whole day's start, local time (e.g. a special bucket made from an all-day marker). */
const atMidnight = (iso: string) => {
    const date = new Date(iso);
    return date.getHours() === 0 && date.getMinutes() === 0;
};

export default function PlannedWeekView({ initialDate, onDraggingChange, onPlanDirty }: PlannedWeekViewProps) {
    const plan = usePlan();
    const tasks = useTasks();
    const placement = usePlacement();
    const startTracking = useStartTracking();
    const stopTracking = useStopTracking();
    const complete = useCompleteTask();
    const client = useQueryClient();
    const [choices, setChoices] = useState<PlanAlternative[] | null>(null);
    const [editingZone, setEditingZone] = useState<DayZone | null>(null);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [newTaskDraft, setNewTaskDraft] = useState<{ start: Date; durationMinutes: number } | null>(null);
    const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
    const [actionToast, setActionToast] = useState<string | null>(null);
    const [autoCompleted, setAutoCompleted] = useState<{ id: string; header: string }[] | null>(null);
    const [weekAnchor, setWeekAnchor] = useState<Date | undefined>(initialDate);
    const markers = useMarkers();
    const bucketTypes = useBucketTypes();
    const [markerDialog, setMarkerDialog] = useState<{ id?: string; day?: Date } | null>(null);
    const [specialId, setSpecialId] = useState<number | null>(null);
    const [merging, setMerging] = useState<{ kept: Task; other: Task } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const marks = useMemo<DayMark[]>(() => [
        ...(markers.data ?? []).map(marker => ({
            id: marker.id, kind: 'marker' as const, title: marker.title, start: new Date(marker.start),
            end: new Date(marker.end), color: '#b0bec5', allDay: marker.all_day,
        })),
        ...(bucketTypes.data ?? []).filter(type => type.is_special && type.special_start && type.special_end)
            .map(type => ({
                id: String(type.id), kind: 'special' as const, title: type.name,
                start: new Date(type.special_start!), end: new Date(type.special_end!),
                color: type.hex_color ?? '#539dad', allDay: atMidnight(type.special_start!) && atMidnight(type.special_end!),
            })),
    ], [markers.data, bucketTypes.data]);
    // "Merge tasks": a line from one card onto another (README: Calendar).
    const mergeDrawing = useDependencyDrawing((fromId, toId) => {
        const byId = new Map((tasks.data ?? []).map(task => [task.id, task]));
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (from && to) setMerging(keptOf(from, to));
    }, { attribute: 'data-task-id', altGr: false });
    const mergeLine = mergeDrawing.line;
    const headerOf = (id: string | null | undefined) => tasks.data?.find(task => task.id === id)?.header ?? '';

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
    // Tracked time beyond the estimate per task (UI-8); the running session
    // counts too, refreshed every minute.
    const settings = useSettings();
    const now = useNow(60_000);
    const overEstimate = useMemo(() => {
        const defaultMinutes = parseDurationMinutes(settings.data?.default_duration ?? null) ?? 60;
        const result = new Map<string, number>();
        for (const task of tasks.data ?? []) {
            if (task.children_ids?.length) continue; // parents: their Rest, not the parts, is on the card
            const running = task.active_tracking_start
                ? (now.getTime() - new Date(task.active_tracking_start).getTime()) / 60000 : 0;
            const spent = (parseDurationMinutes(task.time_spent) ?? 0) + running;
            const over = Math.floor(spent - (parseDurationMinutes(task.duration) ?? defaultMinutes));
            if (over > 0) result.set(task.id, over);
        }
        return result;
    }, [tasks.data, settings.data, now]);
    // The Week view opens on the usual work hours (settings), filling the screen.
    const frameStart = clockMinutes(settings.data?.week_view_start);
    const frameEnd = clockMinutes(settings.data?.week_view_end);
    const viewRange = frameStart !== null && frameEnd !== null && frameEnd > frameStart
        ? { startMinutes: frameStart, endMinutes: frameEnd } : undefined;

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
                    if (data.auto_completed?.length) setAutoCompleted(data.auto_completed);
                },
                onError: error => surface(error, 'Could not complete the task.'),
            }),
    };

    const toast = placement.toast ?? actionToast;
    const clearToast = () => {
        placement.clearToast();
        setActionToast(null);
    };

    const editingTask = tasks.data?.find(task => task.id === editingTaskId) ?? null;

    // Move/resize a bucket by drag: persist the new start + duration.
    const changeZone = (zone: DayZone, start: Date, durationMinutes: number) => {
        saveBucket(client, zone, start.toISOString(), minutesToDurationString(durationMinutes))
            .catch(() => setActionToast('Could not move the bucket.'));
    };

    // Move or resize a task by drag: anchor it (is_fixed) at the new start +
    // duration. The server still enforces predecessor ordering.
    const changeTask = (taskId: string, start: Date, durationMinutes: number) =>
        placement.placeTask(taskId, start, durationMinutes);

    // Track the live drag: signal dragging (gates the countdown) and mark the
    // plan obsolete the moment the drag invalidates an auto-planned task.
    const handleDragChange = (drag: ActiveDrag | null) => {
        setActiveDrag(drag);
        onDraggingChange?.(drag !== null);
        if (drag && overlapsAutoTask(viewTasks, drag)) onPlanDirty?.();
    };

    // While merging, a press on a card draws the line instead of moving or
    // opening the card.
    const onCard = (target: EventTarget) => target instanceof Element && target.closest('[data-task-id]') !== null;
    const mergeCapture = mergeDrawing.active ? {
        onPointerDownCapture: (event: React.PointerEvent) => mergeDrawing.onPointerDown(event),
        onMouseDownCapture: (event: React.MouseEvent) => { if (onCard(event.target)) event.stopPropagation(); },
        onClickCapture: (event: React.MouseEvent) => { if (onCard(event.target)) event.stopPropagation(); },
    } : {};
    const editedSpecial = bucketTypes.data?.find(type => type.id === specialId);
    const editedMarker = markers.data?.find(marker => marker.id === markerDialog?.id);

    return (
        <>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 1 }}>
                <Box sx={{ flexGrow: 1 }}>
                    <FeasibilityBanner warnings={plan.data?.warnings ?? []} />
                    {mergeDrawing.active && (
                        <Alert severity="info" sx={{ mt: 0.5 }}>
                            Drag from one task onto another to merge them. Esc stops.
                        </Alert>
                    )}
                </Box>
                <Tooltip describeChild title="Merge two tasks, e.g. yours and the invitation of the same meeting: drag from one onto the other">
                    <Button size="small" variant={mergeDrawing.active ? 'contained' : 'outlined'}
                        startIcon={<CallMergeIcon />} aria-pressed={mergeDrawing.active}
                        onClick={mergeDrawing.toggle}>
                        Merge tasks
                    </Button>
                </Tooltip>
                <Button
                    size="small" variant="outlined" startIcon={<SkipNextIcon />}
                    disabled={freeDay === null}
                    onClick={() => freeDay && setWeekAnchor(freeDay)}
                >
                    Jump to first free day
                </Button>
            </Box>
            <Box {...mergeCapture} data-merging={mergeDrawing.active ? 'true' : undefined}
                sx={{ display: 'contents', ...(mergeDrawing.active ? { '& [data-task-id]': { cursor: 'crosshair' } } : {}) }}>
            <WeekView
                key={weekAnchor?.toISOString() ?? 'initial'}
                marks={marks}
                onMarkClick={mark => (mark.kind === 'marker' ? setMarkerDialog({ id: mark.id }) : setSpecialId(Number(mark.id)))}
                onMarkCreate={day => setMarkerDialog({ day })}
                tasks={viewTasks.map(task => ({
                    ...task,
                    // The card of the actively tracked task offers ⏹.
                    trackingActive: task.taskId === trackedTaskId,
                    overEstimateMinutes: task.isRest ? undefined : overEstimate.get(task.taskId),
                }))}
                initialDate={weekAnchor}
                viewRange={viewRange}
                zones={zones}
                actions={actions}
                onZoneClick={setEditingZone}
                onZoneChange={changeZone}
                onTaskEdit={setEditingTaskId}
                onTaskChange={changeTask}
                onCreateTask={(start, duration) => setNewTaskDraft({ start, durationMinutes: duration })}
                onTaskDragChange={handleDragChange}
                activeDrag={activeDrag}
            />
            </Box>
            {mergeLine && (
                <DependencyDrawLayer from={mergeLine.from} to={mergeLine.to}
                    onTarget={mergeLine.overKey !== null && mergeLine.overKey !== mergeLine.fromKey}
                    label={mergeLine.overKey && mergeLine.overKey !== mergeLine.fromKey
                        ? `Merge “${headerOf(mergeLine.fromKey)}” and “${headerOf(mergeLine.overKey)}”`
                        : `Drop on the task to merge “${headerOf(mergeLine.fromKey)}” with`} />
            )}
            {merging && (
                <MergeDialog kept={merging.kept} other={merging.other} onClose={() => setMerging(null)}
                    onMerged={(task, notes) => {
                        setNotice([`Merged into “${task.header}”.`, ...notes].join(' '));
                        if (mergeDrawing.active) mergeDrawing.toggle(); // done merging
                    }} />
            )}
            {markerDialog && (markerDialog.day || editedMarker) && (
                <MarkerDialog marker={editedMarker} day={markerDialog.day} onClose={() => setMarkerDialog(null)} />
            )}
            {editedSpecial && (
                <BucketTypeFormDialog open bucketType={editedSpecial} onClose={() => setSpecialId(null)} />
            )}
            <Snackbar open={notice !== null} autoHideDuration={6000} onClose={() => setNotice(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>{notice}</Alert>
            </Snackbar>
            {editingZone && (
                <BucketEditDialog zone={editingZone} onClose={() => setEditingZone(null)} />
            )}
            {/* A card of a task with subtasks is its Rest: it opens the split
                editor (§4.5); every other card opens the task dialog. */}
            {editingTask && (editingTask.children_ids?.length ? (
                <SplitEditor open task={editingTask} onClose={() => setEditingTaskId(null)} />
            ) : (
                <TaskFormDialog open task={editingTask} onClose={() => setEditingTaskId(null)} />
            ))}
            {newTaskDraft && (
                <TaskFormDialog
                    open
                    initialStart={newTaskDraft.start}
                    initialDurationMinutes={newTaskDraft.durationMinutes}
                    defaultAppointment
                    onClose={() => setNewTaskDraft(null)}
                />
            )}
            {/* With choices, the Undo sits in the dialog (see WhatNextDialog). */}
            <WhatNextDialog alternatives={choices} autoCompleted={autoCompleted}
                onClose={() => { setChoices(null); setAutoCompleted(null); }} />
            <CompletionSnackbar autoCompleted={choices ? null : autoCompleted}
                onClose={() => setAutoCompleted(null)} />
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
