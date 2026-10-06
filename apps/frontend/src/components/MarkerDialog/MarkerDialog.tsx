/**
 * A marker (README: Calendar): something on certain days or at a certain
 * time — a conference, a holiday, a deadline. All day (from midnight to
 * midnight, as a calendar's all-day events arrive), or from a time for a
 * while; usable as a named deadline in the task form. "Make special bucket"
 * turns it into time to work in, where the regular buckets give way.
 */
import { useState } from 'react';
import type { AxiosError } from 'axios';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField,
} from '@mui/material';

import { useCreateMarker, useDeleteMarker, useUpdateMarker } from '../../queries.tsx';
import type { Marker, MarkerWrite } from '../../types.ts';
import { addDays, fromDateInput, toDateInput, toDateTimeInput } from '../../utils/dateInput.ts';
import { minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import { formatHoursInput, parseDurationInput } from '../TaskFormDialog/taskFormValidation.ts';
import { BucketTypeFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';
import { useIsMobile } from '../../hooks/useResponsive.ts';

export interface MarkerDialogProps {
    /** Edit this marker; without: a new one on ``day``. */
    marker?: Marker;
    day?: Date;
    onClose: () => void;
}

export function MarkerDialog({ marker, day, onClose }: MarkerDialogProps) {
    const mobile = useIsMobile();
    const editing = marker !== undefined;
    const create = useCreateMarker();
    const update = useUpdateMarker();
    const remove = useDeleteMarker();
    const start = marker ? new Date(marker.start) : day ?? new Date();
    const [title, setTitle] = useState(marker?.title ?? '');
    const [description, setDescription] = useState(marker?.description ?? '');
    const [place, setPlace] = useState(marker?.place ?? '');
    const [allDay, setAllDay] = useState(marker?.all_day ?? true);
    // All day: the first and the last day (shown inclusive).
    const [firstDay, setFirstDay] = useState(toDateInput(start));
    const [lastDay, setLastDay] = useState(toDateInput(marker ? addDays(new Date(marker.end), -1) : start));
    // At a time: when, and for how long (0 = a moment, e.g. a deadline).
    const [moment, setMoment] = useState(toDateTimeInput(marker && !marker.all_day ? start
        : new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12)));
    const [hours, setHours] = useState(marker && !marker.all_day
        ? formatHoursInput(parseDurationMinutes(marker.duration) ?? 0) : '');
    const [error, setError] = useState<string | null>(null);
    const [converting, setConverting] = useState(false);

    const save = () => {
        setError(null);
        if (!title.trim()) {
            setError('The title is empty. Name it, e.g. “Conference” or “Holiday”.');
            return;
        }
        let body: MarkerWrite;
        if (allDay) {
            if (!firstDay || !lastDay || lastDay < firstDay) {
                setError('The last day cannot be before the first.');
                return;
            }
            const from = fromDateInput(firstDay);
            const until = addDays(fromDateInput(lastDay), 1); // midnight after the last day
            body = { start: from.toISOString(), duration: minutesToDurationString((until.getTime() - from.getTime()) / 60000) };
        } else {
            const length = parseDurationInput(hours);
            if (!moment || length.kind === 'invalid') {
                setError(!moment ? 'When is it? Enter a date and time.'
                    : `“${hours}” is not a duration. Use e.g. 2, 1:30 or 90m — or leave it empty for a moment.`);
                return;
            }
            body = { start: new Date(moment).toISOString(),
                duration: minutesToDurationString(length.kind === 'ok' ? length.minutes : 0) };
        }
        body = { ...body, title: title.trim(), description, place: place.trim() };
        const options = {
            onSuccess: onClose,
            onError: (failure: Error) => {
                const data = (failure as AxiosError<Record<string, string[]>>).response?.data;
                const first = data && Object.values(data)[0];
                setError(Array.isArray(first) ? first[0] : 'The marker could not be saved.');
            },
        };
        if (editing) update.mutate({ id: marker.id, patch: body }, options);
        else create.mutate(body, options);
    };

    if (converting && marker) {
        return <BucketTypeFormDialog open fromMarker={marker} onClose={onClose} />;
    }
    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={mobile}>
            <DialogTitle>{editing ? `Marker “${marker.title}”` : 'New marker'}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField label="Title" value={title} autoFocus margin="dense" required
                    onChange={event => setTitle(event.target.value)} />
                <FormControlLabel label="All day"
                    control={<Checkbox checked={allDay} onChange={event => setAllDay(event.target.checked)} />} />
                {allDay ? (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField label="First day" type="date" value={firstDay} fullWidth
                            slotProps={{ inputLabel: { shrink: true } }}
                            onChange={event => {
                                setFirstDay(event.target.value);
                                if (event.target.value > lastDay) setLastDay(event.target.value);
                            }} />
                        <TextField label="Last day" type="date" value={lastDay} fullWidth
                            slotProps={{ inputLabel: { shrink: true } }}
                            onChange={event => setLastDay(event.target.value)} />
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField label="At" type="datetime-local" value={moment} fullWidth
                            slotProps={{ inputLabel: { shrink: true } }}
                            onChange={event => setMoment(event.target.value)} />
                        <TextField label="Duration (hours)" value={hours} fullWidth
                            helperText="Empty = a moment, e.g. a deadline"
                            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                            onChange={event => setHours(event.target.value)} />
                    </Box>
                )}
                <TextField label="Place" value={place} onChange={event => setPlace(event.target.value)}
                    helperText="Optional" />
                <TextField label="Description" value={description} multiline minRows={2}
                    onChange={event => setDescription(event.target.value)} helperText="Optional" />
                {marker?.calendar && (
                    <Alert severity="info">
                        From {marker.calendar.name}: when the event changes there, this marker follows
                        (your own title and description stay).
                    </Alert>
                )}
                {marker && marker.deadline_task_count > 0 && (
                    <Alert severity="info">
                        The deadline of {marker.deadline_task_count === 1 ? 'one task' : `${marker.deadline_task_count} tasks`}:
                        they move with it.
                    </Alert>
                )}
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
                {editing && (
                    <>
                        <Button color="error" disabled={remove.isPending}
                            onClick={() => remove.mutate(marker.id, { onSuccess: onClose })}>
                            Delete
                        </Button>
                        <Button onClick={() => setConverting(true)} sx={{ mr: 'auto' }}>Make special bucket</Button>
                    </>
                )}
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={create.isPending || update.isPending}>
                    {editing ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
