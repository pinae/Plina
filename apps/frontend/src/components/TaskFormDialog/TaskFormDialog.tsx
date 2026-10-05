import { useEffect, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import {
    Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent,
    DialogContentText, DialogTitle, FormControl, FormControlLabel, FormHelperText, FormLabel, IconButton,
    InputLabel, MenuItem, Radio, RadioGroup, Select, Slider, TextField, Tooltip, Typography,
} from '@mui/material';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

import { previewTaskRecurrence } from '../../api.ts';
import { useCreateTask, useDeleteTask, useSettings, useTags, useTasks, useUpdateTask } from '../../queries.tsx';
import { SplitEditor } from '../SplitEditor/SplitEditor.tsx';
import { RecurrenceField } from '../RecurrenceField/RecurrenceField.tsx';
import type { Task, TaskWrite } from '../../types.ts';
import { inheritedColorFor } from '../../utils/taskColors.ts';
import { ColorPicker } from '../ColorPicker/ColorPicker.tsx';
import { formatDuration, minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import {
    formatHoursInput, mapServerErrors, parseDurationInput, validateTaskForm,
    type TaskField, type TaskFormErrors,
} from './taskFormValidation.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';

interface TaskFormDialogProps {
    open: boolean;
    onClose: () => void;
    /** When set, the dialog edits this task instead of creating one. */
    task?: Task;
    /** Prefill for drag-created tasks (create mode only). */
    initialStart?: Date;
    initialDurationMinutes?: number;
    defaultAppointment?: boolean;
    /** T-4: walk to the previous (-1) / next (1) task without closing — the
     *  caller swaps ``task``. Unsaved changes are saved first; an invalid
     *  form refuses. Without it there are no arrows. */
    onNavigate?: (direction: -1 | 1) => void;
    canNavigate?: { previous: boolean; next: boolean };
}

type TaskFormProps = Omit<TaskFormDialogProps, 'open'> & { onSplit: () => void };

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

/** WP-12: the full task form, replacing the minimal WP-9 dialog. The dialog
 *  stays open while the form inside is swapped per task (T-4 navigation). */
export function TaskFormDialog({ open, ...props }: TaskFormDialogProps) {
    const fullScreen = useIsMobile(); // phones (UI-9)
    const [splitting, setSplitting] = useState(false);

    // Splitting replaces this dialog; closing the split editor closes both.
    if (splitting && props.task) {
        return <SplitEditor open={open} task={props.task} onClose={props.onClose} />;
    }
    return (
        <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
            {/* A fresh form per task: its fields start from that task. */}
            <TaskForm key={props.task?.id ?? 'new'} {...props} onSplit={() => setSplitting(true)} />
        </Dialog>
    );
}

function TaskForm({
    onClose, task, initialStart, initialDurationMinutes, defaultAppointment, onNavigate, canNavigate, onSplit,
}: TaskFormProps) {
    const editing = task !== undefined;
    const tags = useTags();
    const tasks = useTasks();
    const settings = useSettings();
    const create = useCreateTask();
    const update = useUpdateTask();
    const deleteTask = useDeleteTask();

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
    // The chosen color (§4.4); null = from the parent / automatic.
    const [ownColor, setOwnColor] = useState<string | null>(task?.own_hex_color ?? null);
    const [isAppointment, setIsAppointment] = useState(task?.is_appointment ?? defaultAppointment ?? false);
    const [start, setStart] = useState(
        toLocalInput(task?.start_date ?? (initialStart ? initialStart.toISOString() : null)),
    );
    const [startIncomplete, setStartIncomplete] = useState(false);
    // Repeats (README: Recurring tasks); "" = once. A recurring task's edit
    // goes to this occurrence or the following ones too.
    const [recurrence, setRecurrence] = useState(task?.recurrence ?? '');
    const recurring = Boolean(task?.series_id);
    const [scope, setScope] = useState<'this' | 'following'>('this');
    const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
    // Unsaved changes = the editable values differ from when the form opened.
    const snapshot = JSON.stringify([header, description, hours, estimateReason, deadline, priority,
        tagIds, chosenParentId, ownColor, isAppointment, start, recurrence]);
    const [initialSnapshot] = useState(snapshot);
    const dirty = snapshot !== initialSnapshot;

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
    // Possible parents: open tasks, never the task itself or its subtasks;
    // never a recurring task (it cannot have subtasks).
    const parentOptions = taskList
        .filter(t => !t.is_done && t.id !== task?.id && !(task && t.ancestor_ids?.includes(task.id)) && !t.series_id)
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

    const pending = create.isPending || update.isPending || deleteTask.isPending;

    /** Save, then ``after`` (close by default, or switch to another task). */
    const submit = (after: () => void = onClose) => {
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
            own_hex_color: ownColor,
            is_appointment: isAppointment,
            start_date: isAppointment && start ? new Date(start).toISOString() : task?.start_date ?? null,
        };
        if (editing && estimateReason) payload.estimate_reason = estimateReason;
        if (recurrence.trim() !== (task?.recurrence ?? '')) payload.recurrence = recurrence.trim();
        if (recurring) payload.scope = scope;
        const options = {
            onSuccess: after,
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

    const deleteAll = () => {
        if (!task) return;
        deleteTask.mutate({ taskId: task.id, occurrences: 'all' }, {
            onSuccess: () => { setConfirmDeleteAll(false); onClose(); },
            onError: () => {
                setConfirmDeleteAll(false);
                setGeneralError('The occurrences could not be deleted. Check your connection and try again.');
            },
        });
    };
    const startIso = isAppointment && start ? new Date(start).toISOString() : null;

    const navigate = (direction: -1 | 1) => {
        if (!onNavigate || !(direction === -1 ? canNavigate?.previous : canNavigate?.next)) return;
        if (dirty) submit(() => onNavigate(direction));
        else onNavigate(direction);
    };

    return (
        // display: contents — only here to catch Alt+↑/↓ from any field.
        <Box sx={{ display: 'contents' }} onKeyDown={event => {
            if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && onNavigate) {
                event.preventDefault();
                navigate(event.key === 'ArrowUp' ? -1 : 1);
            }
        }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{editing ? `Edit “${task.header}”` : 'New task'}</Box>
                {editing && onNavigate && (
                    <Box sx={{ display: 'flex', flexShrink: 0 }}>
                        <Tooltip title="Previous task (Alt+↑)">
                            <span>
                                <IconButton size="small" aria-label="previous task" disabled={!canNavigate?.previous || pending}
                                    onClick={() => navigate(-1)}>
                                    <KeyboardArrowUpIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title="Next task (Alt+↓)">
                            <span>
                                <IconButton size="small" aria-label="next task" disabled={!canNavigate?.next || pending}
                                    onClick={() => navigate(1)}>
                                    <KeyboardArrowDownIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                )}
            </DialogTitle>
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
                <ColorPicker
                    value={ownColor} automatic={!parentId} onChange={setOwnColor}
                    defaultColor={inheritedColorFor(task, parentId, taskList)}
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
                <RecurrenceField
                    label="Repeats" value={recurrence} placeholder="every tuesday at 20:00"
                    onChange={value => { setRecurrence(value); edited('recurrence'); }}
                    preview={text => previewTaskRecurrence(text, startIso)} previewKey={startIso ?? ''}
                    error={shown('recurrence')}
                    helperText={recurring
                        ? 'Empty = no further occurrences after this one'
                        : 'Empty = once. E.g. “every tuesday at 20:00”, “every 4 weeks on tuesday 14:00”, “every first sunday of the month at 12:30”'}
                />
                {recurring && task?.occurrence && (
                    <FormControl>
                        <FormLabel id="task-scope-label" sx={{ typography: 'body2' }}>
                            This occurrence: {new Date(task.occurrence).toLocaleString(undefined, {
                                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}. Save the changes for
                        </FormLabel>
                        <RadioGroup row aria-labelledby="task-scope-label" value={scope}
                            onChange={event => setScope(event.target.value as 'this' | 'following')}>
                            <FormControlLabel value="this" control={<Radio size="small" />} label="this occurrence" />
                            <FormControlLabel value="following" control={<Radio size="small" />}
                                label="this and the following ones" />
                        </RadioGroup>
                        {recurrence.trim() !== (task.recurrence ?? '') && (
                            <FormHelperText>A changed rule applies from this occurrence on.</FormHelperText>
                        )}
                    </FormControl>
                )}
                {attempts > 0 && visibleErrorCount > 0 && (
                    <Alert severity="error">
                        Please fix the highlighted field{visibleErrorCount > 1 ? `s (${visibleErrorCount})` : ''} before saving.
                    </Alert>
                )}
                {generalError && <Alert severity="error">{generalError}</Alert>}
            </DialogContent>
            <DialogActions>
                {editing && !recurring && (
                    <Button onClick={onSplit} sx={{ mr: 'auto' }}>
                        {task.children_ids?.length ? `Edit parts (${task.children_ids.length})` : 'Split into subtasks'}
                    </Button>
                )}
                {editing && recurring && (
                    <Button color="error" onClick={() => setConfirmDeleteAll(true)} disabled={pending} sx={{ mr: 'auto' }}>
                        Delete all occurrences
                    </Button>
                )}
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={() => submit()} disabled={pending}>
                    {editing ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
            {editing && recurring && (
                <Dialog open={confirmDeleteAll} onClose={() => setConfirmDeleteAll(false)} maxWidth="xs">
                    <DialogTitle>Delete all occurrences?</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            {task.occurrence_count === 1
                                ? `“${task.header}” will not repeat any more.`
                                : `All ${task.occurrence_count} occurrences of “${task.header}” are deleted, completed ones too, and it will not repeat any more.`}
                            {' '}This cannot be undone. To delete only this occurrence, delete it in the Tasks tab.
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConfirmDeleteAll(false)}>Cancel</Button>
                        <Button color="error" variant="contained" onClick={deleteAll} disabled={deleteTask.isPending}>
                            Delete all
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
        </Box>
    );
}
