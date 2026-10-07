/**
 * Tracked time (README: Time sheet): correct what was tracked — a task left
 * running over night, a start that was too late — and enter time that was
 * not tracked live. By task (from the task form): all of its tracked time.
 * By day (from the time sheet): everything begun that day, on any task.
 *
 * Each stretch has a day, a from and an until; an until at or before the
 * from is on the next day. The server refuses an end before the start, time
 * in the future and overlaps (one task at a time); the task's tracked time,
 * the plan and the time sheet follow every change.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, TextField, Tooltip, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { useCreateSession, useDeleteSession, useSessions, useTasks, useUpdateSession } from '../../queries.tsx';
import type { Task, TrackedSession } from '../../types.ts';
import { fromDateInput, toDateInput } from '../../utils/dateInput.ts';
import { hoursAndMinutes } from '../../utils/duration.ts';
import { composeSpan, refusal, toTimeInput, untilNextDay } from '../../utils/trackedTime.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';

const shrink = { inputLabel: { shrink: true } };
/** Room for "08:30 AM" where the browser shows 12-hour times. */
const TIME_WIDTH = 140;

const secondsOf = (span: { start: Date; end: Date | null } | null) =>
    (span?.end ? Math.max(0, (span.end.getTime() - span.start.getTime()) / 1000) : null);

/** One stretch of tracked time, editable in place. */
/** ``byDay``: the dialog shows the day, the row names the task instead. */
function SessionRow({ session, byDay }: { session: TrackedSession; byDay: boolean }) {
    const update = useUpdateSession();
    const remove = useDeleteSession();
    const initial = {
        date: toDateInput(session.start), from: toTimeInput(session.start),
        until: session.end ? toTimeInput(session.end) : '',
    };
    const [date, setDate] = useState(initial.date);
    const [from, setFrom] = useState(initial.from);
    const [until, setUntil] = useState(initial.until);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dirty = date !== initial.date || from !== initial.from || until !== initial.until;
    const span = date && from ? composeSpan(date, from, until) : null;
    const seconds = dirty ? secondsOf(span) : session.seconds;

    const save = () => {
        setError(null);
        if (!span) {
            setError('When did it start? Enter the day and the time.');
            return;
        }
        if (!span.end && !session.running) {
            setError('When did it end?');
            return;
        }
        update.mutate({ id: session.id, patch: { start: span.start.toISOString(), end: span.end?.toISOString() ?? null } },
            { onError: failure => setError(refusal(failure, 'The time could not be saved.')) });
    };

    return (
        <Box data-testid="tracked-session" data-running={session.running ? 'true' : undefined}
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, py: 1.25,
                borderBottom: 1, borderColor: 'divider' }}>
            {byDay && (
                <Box sx={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle2">{session.task_header}</Typography>
                    {session.task_tags.map(tag => (
                        <Chip key={tag.id} size="small" label={`#${tag.name}`}
                            sx={{ bgcolor: tag.hex_color, color: '#fff', height: 18 }} />
                    ))}
                </Box>
            )}
            {!byDay && (
                <TextField label="Day" type="date" size="small" value={date} slotProps={shrink}
                    onChange={event => setDate(event.target.value)} sx={{ width: 160 }} />
            )}
            <TextField label="From" type="time" size="small" value={from} slotProps={shrink}
                onChange={event => setFrom(event.target.value)} sx={{ width: TIME_WIDTH }} />
            <TextField label="Until" type="time" size="small" value={until}
                onChange={event => setUntil(event.target.value)} sx={{ width: TIME_WIDTH }}
                helperText={untilNextDay(from, until) ? 'the next day' : session.running && !until ? 'running' : undefined}
                slotProps={{ ...shrink, formHelperText: { sx: { mx: 0 } } }} />
            <Typography variant="body2" sx={{ minWidth: 56 }} data-testid="session-duration">
                {seconds === null ? '' : hoursAndMinutes(seconds)}
            </Typography>
            {session.running && !dirty && <Chip size="small" color="success" label="running" />}
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {dirty && (
                    <>
                        <Button size="small" onClick={() => { setDate(initial.date); setFrom(initial.from); setUntil(initial.until); setError(null); }}>
                            Undo
                        </Button>
                        <Button size="small" variant="contained" onClick={save} disabled={update.isPending}>Save</Button>
                    </>
                )}
                <Tooltip title="Delete this time">
                    <IconButton size="small" aria-label="delete this time" onClick={() => setConfirming(true)}>
                        <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>
            {confirming && (
                <Alert severity="warning" sx={{ flexBasis: '100%' }} action={
                    <>
                        <Button color="inherit" size="small" disabled={remove.isPending}
                            onClick={() => remove.mutate(session.id, {
                                onError: failure => { setConfirming(false); setError(refusal(failure, 'The time could not be deleted.')); },
                            })}>
                            Delete
                        </Button>
                        <Button color="inherit" size="small" onClick={() => setConfirming(false)}>Keep</Button>
                    </>
                }>
                    Delete {hoursAndMinutes(session.seconds)} on “{session.task_header}”?
                </Alert>
            )}
            {error && <Alert severity="error" sx={{ flexBasis: '100%' }}>{error}</Alert>}
        </Box>
    );
}

/** "Project › Task" for the task picker; appointments and repeating tasks
 *  with their date ("Team call · Tue 13/10"), as several share a name. */
function useTaskOptions() {
    const tasks = useTasks();
    return useMemo(() => {
        const list = tasks.data ?? [];
        const byId = new Map(list.map(task => [task.id, task]));
        const when = (task: Task) => {
            const date = task.is_appointment || task.series_id ? task.start_date ?? task.occurrence : null;
            return date ? ` · ${new Date(date).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' })}` : '';
        };
        return list
            .map(task => ({ task, name: [...task.ancestor_ids.map(id => byId.get(id)?.header ?? ''), task.header].join(' › ') }))
            // Open ones first, by name, then in the order of their dates.
            .sort((a, b) => Number(a.task.is_done) - Number(b.task.is_done) || a.name.localeCompare(b.name)
                || (a.task.start_date ?? a.task.occurrence ?? '').localeCompare(b.task.start_date ?? b.task.occurrence ?? ''))
            .map(({ task, name }) => ({ task, label: name + when(task) }));
    }, [tasks.data]);
}

function AddTime({ task, day }: { task?: Pick<Task, 'id' | 'header'>; day?: string }) {
    const create = useCreateSession();
    const options = useTaskOptions();
    const [taskId, setTaskId] = useState<string | null>(task?.id ?? null);
    const [ownDate, setDate] = useState(toDateInput(new Date()));
    const [from, setFrom] = useState('');
    const [until, setUntil] = useState('');
    const [error, setError] = useState<string | null>(null);
    const date = day ?? ownDate;
    const span = date && from && until ? composeSpan(date, from, until) : null;
    const seconds = secondsOf(span);

    const add = () => {
        setError(null);
        if (!taskId) {
            setError('On which task? Choose one.');
            return;
        }
        if (!span) {
            setError('Enter when it began and when it ended.');
            return;
        }
        create.mutate({ task_id: taskId, start: span.start.toISOString(), end: span.end!.toISOString() }, {
            onSuccess: () => { setFrom(''); setUntil(''); },
            onError: failure => setError(refusal(failure, 'The time could not be added.')),
        });
    };

    return (
        <Box component="form" aria-label="add time" sx={{ mt: 2 }}
            onSubmit={event => { event.preventDefault(); add(); }}>
            <Typography variant="subtitle2" gutterBottom>Add time you did not track live</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                {!task && (
                    <Autocomplete size="small" options={options} sx={{ flex: '1 1 260px' }}
                        value={options.find(option => option.task.id === taskId) ?? null}
                        onChange={(_event, option) => setTaskId(option?.task.id ?? null)}
                        isOptionEqualToValue={(a, b) => a.task.id === b.task.id}
                        getOptionKey={option => option.task.id}
                        renderInput={params => <TextField {...params} label="Task" />} />
                )}
                {!day && (
                    <TextField label="Day" type="date" size="small" value={ownDate} slotProps={shrink}
                        onChange={event => setDate(event.target.value)} sx={{ width: 160 }} />
                )}
                <TextField label="From" type="time" size="small" value={from} slotProps={shrink}
                    onChange={event => setFrom(event.target.value)} sx={{ width: TIME_WIDTH }} />
                <TextField label="Until" type="time" size="small" value={until}
                    onChange={event => setUntil(event.target.value)} sx={{ width: TIME_WIDTH }}
                    helperText={untilNextDay(from, until) ? 'the next day' : undefined}
                    slotProps={{ ...shrink, formHelperText: { sx: { mx: 0 } } }} />
                <Typography variant="body2" sx={{ minWidth: 56 }}>{seconds === null ? '' : hoursAndMinutes(seconds)}</Typography>
                <Button type="submit" variant="outlined" disabled={create.isPending} sx={{ ml: 'auto' }}>Add</Button>
            </Box>
            {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        </Box>
    );
}

export interface TrackedTimeDialogProps {
    /** All tracked time of this task (the task form). */
    task?: Pick<Task, 'id' | 'header'>;
    /** Else everything begun on this day (YYYY-MM-DD; default today; the time sheet). */
    day?: string;
    onClose: () => void;
}

export function TrackedTimeDialog({ task, day, onClose }: TrackedTimeDialogProps) {
    const mobile = useIsMobile();
    const byTask = task !== undefined;
    const [shownDay, setShownDay] = useState(day ?? toDateInput(new Date()));
    const sessions = useSessions(byTask ? { task: task.id } : { from: shownDay, to: shownDay });
    // A task's: the latest first; a day's: in the order of the day.
    const list = [...(sessions.data ?? [])].sort((a, b) => (byTask ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
    const total = list.reduce((sum, session) => sum + session.seconds, 0);
    const dayName = shownDay ? fromDateInput(shownDay).toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long',
    }) : '';

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={mobile}>
            <DialogTitle>{byTask ? `Tracked time of “${task.header}”` : 'Tracked time'}</DialogTitle>
            <DialogContent>
                {!byTask && (
                    <TextField label="Day" type="date" size="small" value={shownDay} slotProps={shrink}
                        onChange={event => setShownDay(event.target.value)} sx={{ mt: 1, mb: 1, width: 180 }} />
                )}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Correct a time — e.g. a task left running over night — or delete it. An until at or before
                    the from is on the next day.
                </Typography>
                {sessions.isPending && <CircularProgress size={24} />}
                {sessions.isError && <Alert severity="error">The tracked time could not be loaded.</Alert>}
                {sessions.isSuccess && list.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                        {byTask ? 'No time tracked on this task yet.' : `Nothing tracked on ${dayName}.`}
                    </Typography>
                )}
                {list.map(session => (
                    <SessionRow key={`${session.id}@${session.start}-${session.end}`} session={session} byDay={!byTask} />
                ))}
                {list.length > 0 && (
                    <Typography variant="body2" sx={{ mt: 1, textAlign: 'right' }} data-testid="tracked-total">
                        Together: <strong>{hoursAndMinutes(total)}</strong>
                    </Typography>
                )}
                <AddTime task={task} day={byTask ? undefined : shownDay} />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
}
