import { useEffect, useRef, useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControl, InputLabel, List, ListItem, MenuItem,
    Select, TextField,
} from '@mui/material';

import { previewRecurrence } from '../../api.ts';
import {
    useCreateBucketType, useCreateProject, useCreateTag,
    useTags, useUpdateBucketType, useUpdateProject, useUpdateTag,
} from '../../queries.tsx';
import type { Project, Tag, TimeBucketType } from '../../types.ts';
import { parseDurationMinutes } from '../../utils/duration.ts';

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

export function ProjectFormDialog({ open, onClose, project }: FormDialogProps & { project?: Project }) {
    const editing = project !== undefined;
    const [name, setName] = useState(project?.name ?? '');
    const [description, setDescription] = useState(project?.description ?? '');
    const [priority, setPriority] = useState(String(project?.priority ?? 5));
    const [tagIds, setTagIds] = useState<string[]>(project?.tags.map(t => t.id) ?? []);
    const create = useCreateProject();
    const update = useUpdateProject();

    const submit = () => {
        if (!name.trim()) return;
        const payload = {
            name: name.trim(), description,
            priority: Number(priority) || 5, tag_ids: tagIds,
        };
        const done = { onSuccess: () => { setName(''); onClose(); } };
        if (editing) {
            update.mutate({ id: project.id, patch: payload }, done);
        } else {
            create.mutate(payload, done);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                    label="Name" value={name} autoFocus margin="dense"
                    onChange={event => setName(event.target.value)}
                />
                <TextField
                    label="Description" value={description} multiline minRows={2}
                    onChange={event => setDescription(event.target.value)}
                />
                <TextField
                    label="Priority" type="number" value={priority}
                    onChange={event => setPriority(event.target.value)}
                />
                <TagMultiSelect value={tagIds} onChange={setTagIds} />
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

const PREVIEW_DEBOUNCE_MS = 300;

/** Hours-as-decimal -> "HH:MM:00" duration string. */
const hoursToDuration = (value: number): string => {
    const whole = Math.max(0, Math.floor(value || 1));
    const minutes = Math.round((Math.max(0, value || 1) % 1) * 60);
    return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
};

export function BucketTypeFormDialog({ open, onClose, bucketType }: FormDialogProps & { bucketType?: TimeBucketType }) {
    const editing = bucketType !== undefined;
    const [name, setName] = useState(bucketType?.name ?? '');
    const [startTimes, setStartTimes] = useState(bucketType?.start_times ?? '');
    const [hours, setHours] = useState(
        bucketType ? String((parseDurationMinutes(bucketType.duration) ?? 240) / 60) : '4',
    );
    const [tagIds, setTagIds] = useState<string[]>(bucketType?.tags.map(t => t.id) ?? []);
    const [occurrences, setOccurrences] = useState<string[]>([]);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
    const create = useCreateBucketType();
    const update = useUpdateBucketType();

    // Live preview: server-parsed occurrences, debounced while typing.
    useEffect(() => {
        clearTimeout(debounce.current);
        if (!startTimes.trim()) {
            setOccurrences([]);
            setPreviewError(null);
            return;
        }
        debounce.current = setTimeout(() => {
            previewRecurrence(startTimes)
                .then(preview => {
                    setOccurrences(preview.occurrences);
                    setPreviewError(null);
                })
                .catch(error => {
                    setOccurrences([]);
                    setPreviewError(
                        error?.response?.data?.detail
                        ?? 'Could not preview the recurrence rule.',
                    );
                });
        }, PREVIEW_DEBOUNCE_MS);
        return () => clearTimeout(debounce.current);
    }, [startTimes]);

    const submit = () => {
        if (!name.trim() || !startTimes.trim()) return;
        const payload = {
            name: name.trim(),
            start_times: startTimes.trim(),
            duration: hoursToDuration(Number(hours)),
            tag_ids: tagIds,
        };
        const done = { onSuccess: () => { setName(''); setStartTimes(''); onClose(); } };
        if (editing) {
            update.mutate({ id: bucketType.id, patch: payload }, done);
        } else {
            create.mutate(payload, done);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{editing ? 'Edit time bucket' : 'New time bucket'}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                    label="Name" value={name} autoFocus margin="dense"
                    onChange={event => setName(event.target.value)}
                />
                <TextField
                    label="Recurrence" value={startTimes}
                    placeholder="every weekday at 09:00"
                    helperText="Plain language, e.g. “every day at 14:00”"
                    onChange={event => setStartTimes(event.target.value)}
                />
                {previewError && <Alert severity="error">{previewError}</Alert>}
                {occurrences.length > 0 && (
                    <List dense sx={{ bgcolor: 'action.hover', borderRadius: 1 }}>
                        {occurrences.map(occurrence => (
                            <ListItem key={occurrence} data-testid="preview-occurrence">
                                {new Date(occurrence).toLocaleString(undefined, {
                                    weekday: 'short', month: 'short', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit',
                                })}
                            </ListItem>
                        ))}
                    </List>
                )}
                <TextField
                    label="Duration (hours)" type="number" value={hours}
                    onChange={event => setHours(event.target.value)}
                />
                <TagMultiSelect value={tagIds} onChange={setTagIds} />
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
