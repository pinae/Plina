import { useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControl, InputLabel, MenuItem,
    Select, TextField,
} from '@mui/material';
import type { AxiosError } from 'axios';

import { previewRecurrence } from '../../api.ts';
import {
    useConvertMarker, useCreateBucketType, useCreateTag, useDeleteBucketType, useSettings,
    useTags, useUpdateBucketType, useUpdateTag,
} from '../../queries.tsx';
import type { BucketTypeWrite, Marker, Tag, TimeBucketType } from '../../types.ts';
import { toDateTimeInput } from '../../utils/dateInput.ts';
import { clockMinutes } from '../../utils/timeScale.ts';
import { parseDurationMinutes } from '../../utils/duration.ts';
import { ColorPicker } from '../ColorPicker/ColorPicker.tsx';
import { RecurrenceField } from '../RecurrenceField/RecurrenceField.tsx';

interface FormDialogProps {
    open: boolean;
    onClose: () => void;
}

export function TagFormDialog({ open, onClose, tag }: FormDialogProps & { tag?: Tag }) {
    const editing = tag !== undefined;
    const [name, setName] = useState(tag?.name ?? '');
    const [color, setColor] = useState(tag?.hex_color ?? '#539dad');
    const create = useCreateTag();
    const update = useUpdateTag();

    const submit = () => {
        if (!name.trim()) return;
        const payload = { name: name.trim(), hex_color: color };
        const done = { onSuccess: () => { setName(''); onClose(); } };
        if (editing) {
            update.mutate({ id: tag.id, patch: payload }, done);
        } else {
            create.mutate(payload, done);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{editing ? 'Edit tag' : 'New tag'}</DialogTitle>
            <DialogContent sx={{ display: 'flex', gap: 2, pt: 1, alignItems: 'center' }}>
                <TextField
                    label="Name" value={name} autoFocus margin="dense" fullWidth
                    onChange={event => setName(event.target.value)}
                />
                <TextField
                    label="Color" type="color" value={color} sx={{ width: 90 }}
                    slotProps={{ inputLabel: { shrink: true } }}
                    onChange={event => setColor(event.target.value)}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={submit} disabled={create.isPending || update.isPending}>
                    {editing ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function TagMultiSelect({ value, onChange }: {
    value: string[]; onChange: (ids: string[]) => void;
}) {
    const tags = useTags();
    return (
        <FormControl fullWidth>
            <InputLabel id="tag-multi-label">Tags</InputLabel>
            <Select
                labelId="tag-multi-label" label="Tags" multiple value={value}
                onChange={event => onChange(event.target.value as string[])}
                renderValue={selected => (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {(selected as string[]).map(id => (
                            <Chip
                                key={id} size="small"
                                label={tags.data?.find(t => t.id === id)?.name ?? id}
                            />
                        ))}
                    </Box>
                )}
            >
                {(tags.data ?? []).map(tag => (
                    <MenuItem key={tag.id} value={tag.id}>{tag.name}</MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}

/** Hours-as-decimal -> "HH:MM:00" duration string. */
const hoursToDuration = (value: number): string => {
    const whole = Math.max(0, Math.floor(value || 1));
    const minutes = Math.round((Math.max(0, value || 1) % 1) * 60);
    return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
};

/** "08:00:00" -> "every day at 08:00": a special bucket's working hours. */
const dailyRule = (time: string | undefined) => `every day at ${(time ?? '09:00').slice(0, 5)}`;

interface BucketTypeFormDialogProps extends FormDialogProps {
    bucketType?: TimeBucketType;
    /** A new special bucket (README: Calendar) for this time frame. */
    special?: { start: Date; end: Date };
    /** Make this marker a special bucket (its calendar link moves along). */
    fromMarker?: Marker;
}

export function BucketTypeFormDialog({ open, onClose, bucketType, special, fromMarker }: BucketTypeFormDialogProps) {
    const editing = bucketType !== undefined;
    // A special bucket (README: Calendar): only within its time frame, where
    // the regular buckets give way to it.
    const isSpecial = Boolean(bucketType?.is_special || special || fromMarker);
    const settings = useSettings();
    // New special buckets work the usual Week view hours each day.
    const workStart = settings.data?.week_view_start;
    const workMinutes = (clockMinutes(settings.data?.week_view_end) ?? 16 * 60 + 45)
        - (clockMinutes(workStart) ?? 8 * 60);
    const [name, setName] = useState(bucketType?.name ?? fromMarker?.title ?? '');
    // null: a new special bucket's defaults, from the settings once they are there.
    const [ownStartTimes, setStartTimes] = useState<string | null>(
        bucketType?.start_times ?? (isSpecial ? null : ''),
    );
    const [ownHours, setHours] = useState<string | null>(
        bucketType ? String((parseDurationMinutes(bucketType.duration) ?? 240) / 60) : isSpecial ? null : '4',
    );
    const startTimes = ownStartTimes ?? dailyRule(workStart);
    const hours = ownHours ?? String(Math.round((workMinutes / 60) * 100) / 100);
    const [frameStart, setFrameStart] = useState(toDateTimeInput(
        bucketType?.special_start ?? special?.start ?? fromMarker?.start));
    const [frameEnd, setFrameEnd] = useState(toDateTimeInput(
        bucketType?.special_end ?? special?.end ?? fromMarker?.end));
    const [error, setError] = useState<string | null>(null);
    const [tagIds, setTagIds] = useState<string[]>(bucketType?.tags.map(t => t.id) ?? []);
    // The chosen color (§4.4); null = automatic, unlike the other types'.
    const [ownColor, setOwnColor] = useState<string | null>(bucketType?.own_hex_color ?? null);
    const create = useCreateBucketType();
    const update = useUpdateBucketType();
    const convert = useConvertMarker();
    const remove = useDeleteBucketType();

    const submit = () => {
        setError(null);
        if (!name.trim() || (!isSpecial && !startTimes.trim())) return;
        if (isSpecial && (!frameStart || !frameEnd || new Date(frameEnd) <= new Date(frameStart))) {
            setError('The time frame needs a start and a later end.');
            return;
        }
        const payload: BucketTypeWrite = {
            name: name.trim(),
            start_times: startTimes.trim(),
            duration: hoursToDuration(Number(hours)),
            tag_ids: tagIds,
            own_hex_color: ownColor,
            ...(isSpecial ? {
                special_start: new Date(frameStart).toISOString(), special_end: new Date(frameEnd).toISOString(),
            } : {}),
        };
        const done = {
            onSuccess: () => { setName(''); setStartTimes(''); setOwnColor(null); onClose(); },
            onError: (failure: Error) => {
                const data = (failure as AxiosError<Record<string, string[] | string>>).response?.data;
                const first = data && Object.values(data)[0];
                setError(Array.isArray(first) ? first[0] : first ?? 'The time bucket could not be saved.');
            },
        };
        if (fromMarker) {
            convert.mutate({ id: fromMarker.id, bucketType: payload }, done);
        } else if (editing) {
            update.mutate({ id: bucketType.id, patch: payload }, done);
        } else {
            create.mutate(payload, done);
        }
    };
    const title = fromMarker ? `Make “${fromMarker.title}” a special bucket`
        : editing ? (isSpecial ? 'Edit special bucket' : 'Edit time bucket')
            : isSpecial ? 'New special bucket' : 'New time bucket';

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                    label="Name" value={name} autoFocus margin="dense"
                    onChange={event => setName(event.target.value)}
                />
                {isSpecial && (
                    <>
                        <Alert severity="info">
                            From the start to the end of its time frame, the regular time buckets give way to
                            this one — e.g. for travel or a hackathon.
                        </Alert>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <TextField label="From" type="datetime-local" value={frameStart} fullWidth
                                slotProps={{ inputLabel: { shrink: true } }}
                                onChange={event => setFrameStart(event.target.value)} />
                            <TextField label="Until" type="datetime-local" value={frameEnd} fullWidth
                                slotProps={{ inputLabel: { shrink: true } }}
                                onChange={event => setFrameEnd(event.target.value)} />
                        </Box>
                    </>
                )}
                <RecurrenceField
                    label={isSpecial ? 'Within it (optional)' : 'Recurrence'} value={startTimes}
                    onChange={setStartTimes} preview={previewRecurrence}
                    placeholder={isSpecial ? 'every day at 09:00' : 'every weekday at 09:00'}
                    helperText={isSpecial
                        ? 'Empty: the whole time frame is one bucket. E.g. “every day at 09:00” with 8 hours'
                        : 'Plain language, e.g. “every day at 14:00”, “every other monday at 9”, “weekdays 8:00 and 13:00”'}
                />
                <TextField
                    label="Duration (hours)" type="number" value={hours}
                    onChange={event => setHours(event.target.value)}
                />
                <TagMultiSelect value={tagIds} onChange={setTagIds} />
                <ColorPicker
                    value={ownColor} onChange={setOwnColor} automatic others="time buckets"
                    defaultColor={bucketType?.auto_hex_color ?? null}
                    chosenHint="Every bucket of this type shows it."
                />
                {bucketType?.calendar && (
                    <Alert severity="info">From {bucketType.calendar.name}: when the event moves, the time frame moves.</Alert>
                )}
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                {editing && isSpecial && (
                    <Button color="error" sx={{ mr: 'auto' }} disabled={remove.isPending}
                        onClick={() => remove.mutate(bucketType.id, { onSuccess: onClose })}>
                        Delete
                    </Button>
                )}
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={submit}
                    disabled={create.isPending || update.isPending || convert.isPending}>
                    {fromMarker ? 'Make special bucket' : editing ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
