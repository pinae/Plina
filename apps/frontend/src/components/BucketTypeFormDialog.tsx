import { useEffect, useRef, useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControl, InputLabel, List, ListItem, MenuItem,
    Select, TextField,
} from '@mui/material';

import { previewRecurrence } from '../api';
import { useCreateBucketType, useCreateProject, useCreateTag, useTags } from '../queries';

interface FormDialogProps {
    open: boolean;
    onClose: () => void;
}

export function TagFormDialog({ open, onClose }: FormDialogProps) {
    const [name, setName] = useState('');
    const [color, setColor] = useState('#539dad');
    const create = useCreateTag();

    const submit = () => {
        if (!name.trim()) return;
        create.mutate(
            { name: name.trim(), hex_color: color },
            { onSuccess: () => { setName(''); onClose(); } },
        );
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>New tag</DialogTitle>
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
                <Button variant="contained" onClick={submit} disabled={create.isPending}>
                    Create
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

export function ProjectFormDialog({ open, onClose }: FormDialogProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('5');
    const [tagIds, setTagIds] = useState<string[]>([]);
    const create = useCreateProject();

    const submit = () => {
        if (!name.trim()) return;
        create.mutate(
            {
                name: name.trim(), description,
                priority: Number(priority) || 5, tag_ids: tagIds,
            },
            { onSuccess: () => { setName(''); onClose(); } },
        );
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>New project</DialogTitle>
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
                <Button variant="contained" onClick={submit} disabled={create.isPending}>
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );
}

const PREVIEW_DEBOUNCE_MS = 300;

export function BucketTypeFormDialog({ open, onClose }: FormDialogProps) {
    const [name, setName] = useState('');
    const [startTimes, setStartTimes] = useState('');
    const [hours, setHours] = useState('4');
    const [tagIds, setTagIds] = useState<string[]>([]);
    const [occurrences, setOccurrences] = useState<string[]>([]);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
    const create = useCreateBucketType();

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
        const whole = Math.max(0, Math.floor(Number(hours) || 1));
        const minutes = Math.round((Math.max(0, Number(hours) || 1) % 1) * 60);
        create.mutate(
            {
                name: name.trim(),
                start_times: startTimes.trim(),
                duration: `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`,
                tag_ids: tagIds,
            },
            { onSuccess: () => { setName(''); setStartTimes(''); onClose(); } },
        );
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>New time bucket type</DialogTitle>
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
                <Button variant="contained" onClick={submit} disabled={create.isPending}>
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );
}
