import { useEffect, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import {
    Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem,
    Select, Slider, TextField, Typography,
} from '@mui/material';

import { useCreateTask, useSettings, useTags, useTasks, useUpdateTask } from '../../queries.tsx';
import { SplitEditor } from '../SplitEditor/SplitEditor.tsx';
import type { Task, TaskWrite } from '../../types.ts';
import { formatDuration, minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import {
    formatHoursInput, mapServerErrors, parseDurationInput, validateTaskForm,
    type TaskField, type TaskFormErrors,
} from './taskFormValidation.ts';

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

/** A partially typed date/time input reports value "" plus validity.badInput. */
const isBadInput = (target: EventTarget) =>
    Boolean((target as HTMLInputElement).validity?.badInput);

/**
 * Red, animated outline for an invalid field: a short shake with an expanding
 * red glow. The keyframe name alternates per save attempt so the animation
 * replays each time the user tries to save with the field still invalid.
 */
const invalidSx = (attempt: number) => {
    const name = attempt % 2 === 0 ? 'plinaInvalidA' : 'plinaInvalidB';
    return {
        [`@keyframes ${name}`]: {
            '0%': { transform: 'translateX(0)', boxShadow: '0 0 0 0 rgba(244, 67, 54, 0.75)' },
            '15%': { transform: 'translateX(-5px)' },
            '30%': { transform: 'translateX(5px)' },
            '45%': { transform: 'translateX(-3px)' },
            '60%': { transform: 'translateX(2px)', boxShadow: '0 0 0 6px rgba(244, 67, 54, 0)' },
            '100%': { transform: 'translateX(0)', boxShadow: '0 0 0 0 rgba(244, 67, 54, 0)' },
        },
        '& .MuiOutlinedInput-root': {
            animation: `${name} 0.7s ease-out 2`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        },
        '& .MuiOutlinedInput-notchedOutline': { borderWidth: 2 },
    };
};

/** WP-12: the full task form, replacing the minimal WP-9 dialog. */
export function TaskFormDialog({
    open, onClose, task, initialStart, initialDurationMinutes, defaultAppointment,
}: TaskFormDialogProps) {
    const editing = task !== undefined;
    const [splitting, setSplitting] = useState(false);
    const tags = useTags();
    const tasks = useTasks();
    const settings = useSettings();
    const create = useCreateTask();
    const update = useUpdateTask();

    const [header, setHeader] = useState(task?.header ?? '');
    const [description, setDescription] = useState(task?.description ?? '');
    // Empty = the user's default duration (UI-8).
    const [hours, setHours] = useState(() => {
        const minutes = task ? parseDurationMinutes(task.duration) : initialDurationMinutes ?? null;
        return minutes !== null ? formatHoursInput(minutes) : '';
    });
    const [estimateReason, setEstimateReason] = useState<'set_to_sum' | null>(null);
    const [deadline, setDeadline] = useState(toLocalInput(task?.latest_finish_date ?? null));
    const [deadlineIncomplete, setDeadlineIncomplete] = useState(false);
    const [priority, setPriority] = useState(task?.priority ?? 5);
    const [tagIds, setTagIds] = useState<string[]>(task?.tags.map(t => t.id) ?? []);
    // undefined = untouched: a new task starts in the active project (§6.2).
    const [chosenParentId, setChosenParentId] = useState<string | null | undefined>(undefined);
    const [isAppointment, setIsAppointment] = useState(task?.is_appointment ?? defaultAppointment ?? false);
    const [start, setStart] = useState(
        toLocalInput(task?.start_date ?? (initialStart ? initialStart.toISOString() : null)),
    );
    const [startIncomplete, setStartIncomplete] = useState(false);

    // Validation state: errors show for a field once it was left (touched) or
    // after the first save attempt, and then update live as the user types.
    const [now] = useState(() => new Date());
    const [attempts, setAttempts] = useState(0);
    const [touched, setTouched] = useState<Partial<Record<TaskField, boolean>>>({});
    const [serverErrors, setServerErrors] = useState<TaskFormErrors>({});
    const [generalError, setGeneralError] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const taskList = tasks.data ?? [];
    const parentId = chosenParentId !== undefined ? chosenParentId
        : editing ? task.parent_id ?? null : settings.data?.active_task_id ?? null;
    // Possible parents: open tasks, never the task itself or its subtasks.
    const parentOptions = taskList
        .filter(t => !t.is_done && t.id !== task?.id && !(task && t.ancestor_ids?.includes(task.id)))
        .map(t => ({
            id: t.id,
            path: [...(t.ancestor_ids ?? []).map(id => taskList.find(a => a.id === id)?.header ?? ''), t.header].join(' › '),
        }));
    const parentOption = parentOptions.find(o => o.id === parentId) ?? null;
    // The earliest deadline among the parent and its ancestors (UI-1 rule).
    const parentDeadline = (() => {
        const parent = taskList.find(t => t.id === parentId);
        if (!parent) return null;
        const chain = [...(parent.ancestor_ids ?? []), parent.id]
            .map(id => taskList.find(t => t.id === id))
            .filter(t => t?.latest_finish_date);
        const earliest = chain.sort((a, b) => a!.latest_finish_date!.localeCompare(b!.latest_finish_date!))[0];
        return earliest ? { header: earliest.header, date: new Date(earliest.latest_finish_date!) } : null;
    })();
    const defaultDuration = parseDurationMinutes(settings.data?.default_duration ?? null) ?? 60;

    const errors = validateTaskForm(
        {
            header, description, hours, deadline, deadlineIncomplete, priority,
            tagIds, parentId: parentId ?? '', isAppointment, start, startIncomplete,
        },
        {
            now,
            knownTagIds: tags.data?.map(t => t.id) ?? null,
            knownParentIds: tasks.data ? parentOptions.map(o => o.id) : null,
            originalDeadline: task ? toLocalInput(task.latest_finish_date) : undefined,
            parentDeadline,
        },
    );
    const shown = (field: TaskField): string | undefined =>
        serverErrors[field] ?? (attempts > 0 || touched[field] ? errors[field] : undefined);
    const visibleErrorCount = (Object.keys(errors) as TaskField[]).filter(f => shown(f)).length
        + (Object.keys(serverErrors) as TaskField[]).filter(f => !errors[f] && serverErrors[f]).length;

    // After a failed save, move the focus to the first invalid field.
    useEffect(() => {
        if (attempts === 0) return;
        contentRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }, [attempts]);

    const edited = (field: TaskField) => {
        if (!serverErrors[field]) return;
        setServerErrors(state => {
            const next = { ...state };
            delete next[field];
            return next;
        });
    };
    const touch = (field: TaskField) => setTouched(state => ({ ...state, [field]: true }));

    /** Error display props shared by the fields. */
    const feedback = (field: TaskField, hint?: string) => {
        const message = shown(field);
        return {
            error: Boolean(message),
            helperText: message ?? hint,
            onBlur: () => touch(field),
            sx: message ? invalidSx(attempts) : undefined,
        };
    };

    const pending = create.isPending || update.isPending;

    const submit = () => {
        setAttempts(n => n + 1);
        setGeneralError(null);
        const duration = parseDurationInput(hours);
        if (Object.keys(errors).length > 0 || duration.kind === 'invalid') return;

        const payload: TaskWrite = {
            header: header.trim(),
            description,
            duration: duration.kind === 'ok' ? minutesToDurationString(duration.minutes) : null,
            latest_finish_date: deadline ? new Date(deadline).toISOString() : null,
            priority,
            tag_ids: tagIds,
            parent_id: parentId,
            is_appointment: isAppointment,
            start_date: isAppointment && start ? new Date(start).toISOString() : task?.start_date ?? null,
        };
        if (editing && estimateReason) payload.estimate_reason = estimateReason;
        const options = {
            onSuccess: onClose,
            onError: (error: Error) => {
                const { fields, general } = mapServerErrors((error as AxiosError).response?.data);
                setServerErrors(fields);
                setGeneralError(
                    general ?? (Object.keys(fields).length ? null : 'The task could not be saved. Check your connection and try again.'),
                );
            },
        };
        if (editing) {
            update.mutate({ taskId: task.id, patch: payload }, options);
        } else {
            create.mutate(payload, options);
        }
    };

    const tagsFeedback = shown('tags');
    const parentFeedback = shown('parent');
    const human = (minutes: number) => formatDuration(minutesToDurationString(minutes));
    const partsMinutes = parseDurationMinutes(task?.parts_total ?? null);
    const spentMinutes = parseDurationMinutes(task?.time_spent ?? null) ?? 0;
    const estimateMinutes = parseDurationMinutes(task?.duration ?? null) ?? defaultDuration;
    const priorityFeedback = shown('priority');

    // Splitting replaces this dialog; closing the split editor closes both.
    if (splitting && task) {
        return <SplitEditor open={open} task={task} onClose={onClose} />;
    }

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>{editing ? `Edit “${task.header}”` : 'New task'}</DialogTitle>
            <DialogContent ref={contentRef} sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                    label="Header" value={header} autoFocus margin="dense" required
                    onChange={event => { setHeader(event.target.value); edited('header'); }}
                    {...feedback('header')}
                />
                <TextField
                    label="Description" value={description} multiline minRows={2}
                    onChange={event => { setDescription(event.target.value); edited('description'); }}
                    {...feedback('description', 'Optional')}
                />
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    <Box sx={{ width: '100%' }}>
                        <TextField
                            label="Duration (hours)" value={hours} fullWidth required={isAppointment}
                            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                            onChange={event => { setHours(event.target.value); setEstimateReason(null); edited('hours'); }}
                            {...feedback('hours', hours.trim() ? 'e.g. 1.5, 1:30 or 90m' : `Empty = your default (${human(defaultDuration)})`)}
                        />
                        {partsMinutes !== null && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                                <Typography variant="body2" color={task?.over_budget ? 'warning.main' : 'text.secondary'}>
                                    Σ parts {human(partsMinutes)} / {human(estimateMinutes)}
                                </Typography>
                                <Button size="small" onClick={() => {
                                    setHours(formatHoursInput(partsMinutes + spentMinutes));
                                    setEstimateReason('set_to_sum');
                                    edited('hours');
                                }}>
                                    Set estimate to Σ parts ({human(partsMinutes + spentMinutes)})
                                </Button>
                            </Box>
                        )}
                        {editing && spentMinutes > 0 && (
                            <Typography variant="body2" color={spentMinutes > estimateMinutes ? 'warning.main' : 'text.secondary'} sx={{ mt: 0.5 }}>
                                Spent {human(spentMinutes)} of {human(estimateMinutes)}
                                {spentMinutes > estimateMinutes ? ` (+${human(spentMinutes - estimateMinutes)})` : ''}
                            </Typography>
                        )}
                    </Box>
                    <TextField
                        label="Deadline" type="datetime-local" value={deadline} fullWidth
                        slotProps={{ inputLabel: { shrink: true } }}
                        onChange={event => {
                            setDeadline(event.target.value);
                            setDeadlineIncomplete(isBadInput(event.target));
                            edited('deadline');
                        }}
                        {...feedback('deadline', 'Optional')}
                        onBlur={event => { setDeadlineIncomplete(isBadInput(event.target)); touch('deadline'); }}
                    />
                </Box>
                <FormControl error={Boolean(priorityFeedback)}>
                    <Typography gutterBottom variant="body2">Priority: {priority}</Typography>
                    <Slider
                        aria-label="priority" min={0} max={10} step={0.5}
                        value={priority}
                        onChange={(_e, value) => { setPriority(value as number); edited('priority'); }}
                    />
                    {priorityFeedback && <FormHelperText>{priorityFeedback}</FormHelperText>}
                </FormControl>
                <FormControl error={Boolean(tagsFeedback)} sx={tagsFeedback ? invalidSx(attempts) : undefined}>
                    <InputLabel id="task-tags-label">Tags</InputLabel>
                    <Select
                        labelId="task-tags-label" label="Tags" multiple value={tagIds}
                        onChange={event => { setTagIds(event.target.value as string[]); edited('tags'); }}
                        onBlur={() => touch('tags')}
                        renderValue={selected => (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {(selected as string[]).map(id => {
                                    const tag = tags.data?.find(t => t.id === id);
                                    return <Chip key={id} size="small" label={tag?.name ?? 'deleted tag'} />;
                                })}
                            </Box>
                        )}
                    >
                        {(tags.data ?? []).map(tag => (
                            <MenuItem key={tag.id} value={tag.id}>{tag.name}</MenuItem>
                        ))}
                    </Select>
                    {tagsFeedback && <FormHelperText>{tagsFeedback}</FormHelperText>}
                </FormControl>
                <Autocomplete
                    options={parentOptions}
                    value={parentOption}
                    getOptionLabel={option => option.path}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    onChange={(_event, option) => { setChosenParentId(option?.id ?? null); edited('parent'); }}
                    // Emptying the text means "no parent" (a project of its own).
                    onInputChange={(_event, value, reason) => {
                        if (reason === 'input' && value === '') { setChosenParentId(null); edited('parent'); }
                    }}
                    onBlur={() => touch('parent')}
                    renderInput={params => (
                        <TextField {...params} label="Parent" error={Boolean(parentFeedback)}
                            helperText={parentFeedback ?? (parentOption ? 'Part of this project' : 'Empty = a project of its own')}
                            sx={parentFeedback ? invalidSx(attempts) : undefined} />
                    )}
                />
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
                        label="Start" type="datetime-local" value={start} required
                        slotProps={{ inputLabel: { shrink: true } }}
                        onChange={event => {
                            setStart(event.target.value);
                            setStartIncomplete(isBadInput(event.target));
                            edited('start');
                        }}
                        {...feedback('start')}
                        onBlur={event => { setStartIncomplete(isBadInput(event.target)); touch('start'); }}
                    />
                )}
                {attempts > 0 && visibleErrorCount > 0 && (
                    <Alert severity="error">
                        Please fix the highlighted field{visibleErrorCount > 1 ? `s (${visibleErrorCount})` : ''} before saving.
                    </Alert>
                )}
                {generalError && <Alert severity="error">{generalError}</Alert>}
            </DialogContent>
            <DialogActions>
                {editing && (
                    <Button onClick={() => setSplitting(true)} sx={{ mr: 'auto' }}>
                        {task.children_ids?.length ? `Edit parts (${task.children_ids.length})` : 'Split into subtasks'}
                    </Button>
                )}
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={submit} disabled={pending}>
                    {editing ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
