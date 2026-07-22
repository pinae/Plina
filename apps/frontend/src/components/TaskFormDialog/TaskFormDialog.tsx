import { useState } from 'react';
import {
    Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem,
    Select, Slider, TextField, Typography,
} from '@mui/material';

import { useCreateTask, useProjects, useTags, useUpdateTask } from '../../queries.tsx';
import type { Task, TaskWrite } from '../../types.ts';
import { parseDurationMinutes } from '../../utils/duration.ts';

interface TaskFormDialogProps {
    open: boolean;
    onClose: () => void;
    /** When set, the dialog edits this task instead of creating one. */
    task?: Task;
    /** Prefill for drag-created tasks (create mode only). */
    initialStart?: Date;
    initialDurationMinutes?: number;
    defaultAppointment?: boolean;
}

const toLocalInput = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const hoursToDuration = (hours: number): string => {
    const whole = Math.max(0, Math.floor(hours));
    const minutes = Math.round((Math.max(0, hours) % 1) * 60);
    return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
};

/** WP-12: the full task form, replacing the minimal WP-9 dialog. */
export function TaskFormDialog({
    open, onClose, task, initialStart, initialDurationMinutes, defaultAppointment,
}: TaskFormDialogProps) {
    const editing = task !== undefined;
    const tags = useTags();
    const projects = useProjects();
    const create = useCreateTask();
    const update = useUpdateTask();

    const [header, setHeader] = useState(task?.header ?? '');
    const [description, setDescription] = useState(task?.description ?? '');
    const [hours, setHours] = useState(
        task ? String((parseDurationMinutes(task.duration) ?? 60) / 60)
            : initialDurationMinutes ? String(initialDurationMinutes / 60) : '1',
    );
    const [deadline, setDeadline] = useState(toLocalInput(task?.latest_finish_date ?? null));
    const [priority, setPriority] = useState(task?.priority ?? 5);
    const [tagIds, setTagIds] = useState<string[]>(task?.tags.map(t => t.id) ?? []);
    const [projectId, setProjectId] = useState<string>(task?.project_id ?? '');
    const [isAppointment, setIsAppointment] = useState(task?.is_appointment ?? defaultAppointment ?? false);
    const [start, setStart] = useState(
        toLocalInput(task?.start_date ?? (initialStart ? initialStart.toISOString() : null)),
    );

    const pending = create.isPending || update.isPending;

    const submit = () => {
        if (!header.trim()) return;
        const payload: TaskWrite = {
            header: header.trim(),
            description,
            duration: hoursToDuration(Number(hours) || 1),
            latest_finish_date: deadline ? new Date(deadline).toISOString() : null,
            priority,
            tag_ids: tagIds,
            project_id: projectId || null,
            is_appointment: isAppointment,
            start_date: isAppointment && start ? new Date(start).toISOString() : task?.start_date ?? null,
        };
        const options = { onSuccess: onClose };
        if (editing) {
            update.mutate({ taskId: task.id, patch: payload }, options);
        } else {
            create.mutate(payload, options);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>{editing ? `Edit “${task.header}”` : 'New task'}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                    label="Header" value={header} autoFocus margin="dense"
                    onChange={event => setHeader(event.target.value)}
                />
                <TextField
                    label="Description" value={description} multiline minRows={2}
                    onChange={event => setDescription(event.target.value)}
                />
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                        label="Duration (hours)" type="number" value={hours} fullWidth
                        onChange={event => setHours(event.target.value)}
                    />
                    <TextField
                        label="Deadline" type="datetime-local" value={deadline} fullWidth
                        slotProps={{ inputLabel: { shrink: true } }}
                        onChange={event => setDeadline(event.target.value)}
                    />
                </Box>
                <Box>
                    <Typography gutterBottom variant="body2">Priority: {priority}</Typography>
                    <Slider
                        aria-label="priority" min={0} max={10} step={0.5}
                        value={priority}
                        onChange={(_e, value) => setPriority(value as number)}
                    />
                </Box>
                <FormControl>
                    <InputLabel id="task-tags-label">Tags</InputLabel>
                    <Select
                        labelId="task-tags-label" label="Tags" multiple value={tagIds}
                        onChange={event => setTagIds(event.target.value as string[])}
                        renderValue={selected => (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {(selected as string[]).map(id => {
                                    const tag = tags.data?.find(t => t.id === id);
                                    return <Chip key={id} size="small" label={tag?.name ?? id} />;
                                })}
                            </Box>
                        )}
                    >
                        {(tags.data ?? []).map(tag => (
                            <MenuItem key={tag.id} value={tag.id}>{tag.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControl>
                    <InputLabel id="task-project-label">Project</InputLabel>
                    <Select
                        labelId="task-project-label" label="Project" value={projectId}
                        onChange={event => setProjectId(event.target.value)}
                    >
                        <MenuItem value="">No project</MenuItem>
                        {(projects.data ?? []).map(project => (
                            <MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={isAppointment}
                            onChange={event => setIsAppointment(event.target.checked)}
                        />
                    }
                    label="Appointment (fixed time, ignores buckets)"
                />
                {isAppointment && (
                    <TextField
                        label="Start" type="datetime-local" value={start}
                        slotProps={{ inputLabel: { shrink: true } }}
                        onChange={event => setStart(event.target.value)}
                    />
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={submit} disabled={pending}>
                    {editing ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
