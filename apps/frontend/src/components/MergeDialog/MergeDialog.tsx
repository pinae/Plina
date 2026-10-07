/**
 * Merging two tasks into one (README: Calendar), side by side like Meld:
 * the kept task on the left, the one merged in on the right, the result in
 * the middle. Arrows copy a field from either side into the result; title,
 * description and place can be edited there. "Merge" saves the result into
 * the kept task; the other one's tracked time, dependencies, subtasks and
 * calendar link move over, then it is deleted.
 *
 * Without ``other`` it compares a task with its calendar event as last read
 * ("Compare with the calendar"): what the calendar changed but Plina kept
 * can be taken over, and is settled either way.
 */
import { useMemo, useState } from 'react';
import type { AxiosError } from 'axios';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField,
    Tooltip, Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EventIcon from '@mui/icons-material/Event';

import { useMergeTasks, useTags, useTasks, useUpdateTask } from '../../queries.tsx';
import type { Task, TaskWrite } from '../../types.ts';
import { formatDuration, parseDurationMinutes } from '../../utils/duration.ts';
import { eventSideOf, sideOf, type MergeSide } from '../../utils/merge.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';

type Field = keyof Omit<MergeSide, 'deadline_marker'>;

const FIELDS: { key: Field; label: string; text?: boolean; multiline?: boolean }[] = [
    { key: 'header', label: 'Title', text: true },
    { key: 'description', label: 'Description', text: true, multiline: true },
    { key: 'place', label: 'Place', text: true },
    { key: 'is_appointment', label: 'Appointment' },
    { key: 'start_date', label: 'Start' },
    { key: 'duration', label: 'Duration' },
    { key: 'latest_finish_date', label: 'Deadline' },
    { key: 'priority', label: 'Priority' },
    { key: 'tag_ids', label: 'Tags' },
    { key: 'parent_id', label: 'Project' },
];
/** What a calendar event says (compare mode). */
const EVENT_FIELDS: Field[] = ['header', 'description', 'place', 'start_date', 'duration'];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const sameMoment = (a: string | null, b: string | null) =>
    a === b || (a !== null && b !== null && new Date(a).getTime() === new Date(b).getTime());

const equal = (field: Field, a: MergeSide, b: MergeSide) => {
    if (field === 'start_date' || field === 'latest_finish_date') {
        return sameMoment(a[field], b[field]) && (field === 'start_date' || same(a.deadline_marker?.id, b.deadline_marker?.id));
    }
    if (field === 'duration') return parseDurationMinutes(a.duration) === parseDurationMinutes(b.duration);
    if (field === 'tag_ids') return same([...a.tag_ids].sort(), [...b.tag_ids].sort());
    return same(a[field], b[field]);
};

/** The result starts as the kept task, its empty fields filled from the other. */
function initialResult(kept: MergeSide, other: MergeSide): MergeSide {
    return {
        ...kept,
        description: kept.description || other.description,
        place: kept.place || other.place,
        start_date: kept.start_date ?? other.start_date,
        duration: kept.duration ?? other.duration,
        latest_finish_date: kept.latest_finish_date ?? other.latest_finish_date,
        deadline_marker: kept.latest_finish_date ? kept.deadline_marker : other.deadline_marker,
        tag_ids: kept.tag_ids.length ? kept.tag_ids : other.tag_ids,
        parent_id: kept.parent_id ?? other.parent_id,
    };
}

const writeOf = (result: MergeSide): TaskWrite => ({
    header: result.header.trim(), description: result.description, place: result.place.trim(),
    is_appointment: result.is_appointment, start_date: result.start_date, duration: result.duration,
    priority: result.priority, tag_ids: result.tag_ids, parent_id: result.parent_id,
    ...(result.deadline_marker
        ? { deadline_marker_id: result.deadline_marker.id }
        : { latest_finish_date: result.latest_finish_date, deadline_marker_id: null }),
});

export interface MergeDialogProps {
    /** The task that stays (left). */
    kept: Task;
    /** The task merged into it (right); none: compare with ``kept``'s calendar event. */
    other?: Task | null;
    onClose: () => void;
    /** After a merge: the kept task and notes (e.g. a dependency left out). */
    onMerged?: (task: Task, notes: string[]) => void;
}

export function MergeDialog({ kept, other = null, onClose, onMerged }: MergeDialogProps) {
    const mobile = useIsMobile();
    const tasks = useTasks();
    const tags = useTags();
    const merge = useMergeTasks();
    const update = useUpdateTask();
    const comparing = other === null;
    const left = useMemo(() => sideOf(kept), [kept]);
    const right = useMemo(() => (other ? sideOf(other) : eventSideOf(kept)), [kept, other]);
    const [result, setResult] = useState<MergeSide>(() => (comparing ? left : initialResult(left, right)));
    const [error, setError] = useState<string | null>(null);
    const fields = comparing ? FIELDS.filter(field => EVENT_FIELDS.includes(field.key)) : FIELDS;
    const pending = new Set<string>(kept.calendar?.pending ?? []);

    const byId = new Map((tasks.data ?? []).map(task => [task.id, task]));
    const tagName = new Map((tags.data ?? []).map(tag => [tag.id, tag.name]));
    const shown = (field: Field, side: MergeSide): string => {
        const value = side[field];
        if (field === 'start_date' || field === 'latest_finish_date') {
            if (!value) return '';
            const date = new Date(value as string).toLocaleString(undefined, {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            });
            return field === 'latest_finish_date' && side.deadline_marker ? `${side.deadline_marker.title} (${date})` : date;
        }
        if (field === 'duration') return value ? formatDuration(value as string) : '';
        if (field === 'is_appointment') return value ? 'Yes' : 'No';
        if (field === 'tag_ids') return (value as string[]).map(id => `#${tagName.get(id) ?? id}`).join(' ');
        if (field === 'parent_id') {
            const parent = value ? byId.get(value as string) : undefined;
            return parent ? [...parent.ancestor_ids.map(id => byId.get(id)?.header ?? ''), parent.header].join(' › ') : '';
        }
        return String(value ?? '');
    };
    const take = (field: Field, from: MergeSide) => setResult(state => ({
        ...state, [field]: from[field],
        ...(field === 'latest_finish_date' ? { deadline_marker: from.deadline_marker } : {}),
    }));

    const save = () => {
        setError(null);
        if (!result.header.trim()) {
            setError('The title is empty. Take one from either side or type one.');
            return;
        }
        const failed = (failure: Error) => {
            const data = (failure as AxiosError<Record<string, unknown>>).response?.data;
            const first = data && (data.detail ?? Object.values(data)[0]);
            setError(Array.isArray(first) ? String(first[0]) : first ? String(first) : 'The tasks could not be merged.');
        };
        if (!other) {
            update.mutate({ taskId: kept.id, patch: { ...writeOf(result), calendar_resolved: true } },
                { onSuccess: onClose, onError: failed });
        } else {
            merge.mutate({ keptId: kept.id, otherId: other.id, values: writeOf(result) }, {
                onSuccess: response => { onMerged?.(response.task, response.notes); onClose(); },
                onError: failed,
            });
        }
    };

    const column = (title: string, task: Task | null, caption: string) => (
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>{title}</Typography>
            <Typography variant="caption" color="text.secondary" component="div"
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {task?.calendar && <EventIcon sx={{ fontSize: 14 }} />}{caption}
            </Typography>
        </Box>
    );
    const cell = (text: string, multiline = false) => (
        <Typography variant="body2" component="div" sx={{
            minWidth: 0, overflowWrap: 'anywhere', whiteSpace: multiline ? 'pre-wrap' : undefined,
            color: text ? undefined : 'text.disabled', fontStyle: text ? undefined : 'italic',
            maxHeight: multiline ? 160 : undefined, overflowY: multiline ? 'auto' : undefined,
        }}>
            {text || 'empty'}
        </Typography>
    );
    const busy = merge.isPending || update.isPending;

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="lg" fullScreen={mobile}>
            <DialogTitle>{comparing ? `Compare “${kept.header}” with ${kept.calendar?.name ?? 'the calendar'}`
                : 'Merge two tasks'}</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {!other
                        ? 'Your task on the left, the event as the calendar has it now on the right. Take over what you want; the rest stays yours.'
                        : `“${kept.header}” stays: its tracked time, dependencies and place in the tree. “${other.header}” is merged into it and then deleted${other.calendar ? `; its link to ${other.calendar.name} moves over, so updates of the event go to the kept task` : ''}.`}
                </Typography>
                <Box role="table" aria-label="merge" sx={{
                    display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) 40px minmax(0, 1.2fr) 40px minmax(0, 1fr)',
                    columnGap: 1, rowGap: 0.5, alignItems: 'start', overflowX: 'auto', minWidth: mobile ? 720 : undefined,
                }}>
                    <Box />
                    {column(kept.header, kept, comparing ? 'Your task' : `Stays${kept.calendar ? ` · from ${kept.calendar.name}` : ''}`)}
                    <Box />
                    {column('Result', null, comparing ? 'Saved into your task' : 'The merged task')}
                    <Box />
                    {!other
                        ? column(right.header, kept, `${kept.calendar?.name} · as read last`)
                        : column(other.header, other, `Merged in, then deleted${other.calendar ? ` · from ${other.calendar.name}` : ''}`)}
                    {fields.map(({ key, label, text, multiline }) => {
                        const differs = !equal(key, left, right);
                        const changedByCalendar = comparing && pending.has(key);
                        return (
                            <Box key={key} role="row" data-testid={`merge-row-${key}`} data-differs={differs ? 'true' : undefined}
                                sx={{ display: 'contents' }}>
                                <Typography role="rowheader" variant="body2" component="div" color="text.secondary" sx={{ pt: 1 }}>
                                    {label}
                                    {changedByCalendar && <Chip size="small" color="warning" label="changed" sx={{ ml: 0.5, height: 18 }} />}
                                </Typography>
                                <Box role="cell" sx={{ pt: 1, bgcolor: differs ? 'action.hover' : undefined, px: 0.5, borderRadius: 1 }}>
                                    {cell(shown(key, left), multiline)}
                                </Box>
                                <Tooltip title={`Take the ${label.toLowerCase()} from the left`}>
                                    <span>
                                        <IconButton size="small" aria-label={`take ${label} from the left`} disabled={!differs && equal(key, left, result)}
                                            onClick={() => take(key, left)} sx={{ mt: 0.5 }}>
                                            <ArrowForwardIcon fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Box role="cell" data-testid={`merge-result-${key}`}>
                                    {text ? (
                                        <TextField size="small" fullWidth multiline={multiline} maxRows={6}
                                            value={result[key] as string}
                                            slotProps={{ htmlInput: { 'aria-label': `merged ${label}` } }}
                                            onChange={event => setResult(state => ({ ...state, [key]: event.target.value }))} />
                                    ) : (
                                        <Box sx={{ pt: 1, px: 1 }}>{cell(shown(key, result))}</Box>
                                    )}
                                </Box>
                                <Tooltip title={`Take the ${label.toLowerCase()} from the right`}>
                                    <span>
                                        <IconButton size="small" aria-label={`take ${label} from the right`} disabled={!differs && equal(key, right, result)}
                                            onClick={() => take(key, right)} sx={{ mt: 0.5 }}>
                                            <ArrowBackIcon fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Box role="cell" sx={{ pt: 1, bgcolor: differs ? 'action.hover' : undefined, px: 0.5, borderRadius: 1 }}>
                                    {cell(shown(key, right), multiline)}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={busy}>{comparing ? 'Save' : 'Merge'}</Button>
            </DialogActions>
        </Dialog>
    );
}
