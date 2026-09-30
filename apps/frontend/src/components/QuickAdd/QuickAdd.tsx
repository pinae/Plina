/**
 * UI-5: one-line task capture in the header (docs/task-entry-ui.md §3.3).
 *
 * The text is parsed on every keystroke (``parseQuickAdd``) and shown as
 * chips below the input: the target project first (the active project
 * unless a `+project` is typed; its ✕ makes this task top-level), then
 * duration, tags, priority, deadline and any error chips. Enter saves and
 * keeps the input open for the next thought; Ctrl/⌘+Enter also opens the
 * task for details; Escape clears. New tasks inherit the parent's tags and
 * priority unless typed, and consume the project's Rest — the snackbar warns
 * (with "Raise estimate") when that pushes the project over budget.
 *
 * UI-9: the ``sheet`` variant (phones, inside the ⊕ bottom sheet) shows the
 * chips permanently plus tappable suggestions for project, tags and
 * estimate, and an Add button — a task can be captured by tapping, apart
 * from typing its name. Typed tokens win over taps.
 */
import { useMemo, useState, type Ref } from 'react';
import { Alert, Box, Button, Chip, IconButton, Paper, Popper, Snackbar, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

import { createTag, fetchTask, updateTask } from '../../api.ts';
import { queryKeys, useCreateTask, useSettings, useTags, useTasks } from '../../queries.tsx';
import { useNow } from '../../hooks/useNow.ts';
import { parseQuickAdd, type QuickAddToken } from '../../utils/quickAdd.ts';
import { projectOptions } from '../../utils/projects.ts';
import { formatDuration, minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import { readRecent, rememberRecent, RECENT_PROJECTS, RECENT_TAGS } from '../../utils/recent.ts';
import { suggestProjects, suggestTags } from '../../utils/suggestions.ts';
import { QuickAddSuggestions } from '../QuickAddSuggestions/QuickAddSuggestions.tsx';
import type { Task, TaskWrite } from '../../types.ts';

const TOKEN_ICON: Partial<Record<QuickAddToken['kind'], string>> = {
    duration: '⏱ ', deadline: '⏰ ', priority: '', tag: '', newTag: '', project: '● ',
};

interface Feedback {
    message: string;
    severity: 'success' | 'warning' | 'error';
    raise?: { taskId: string; duration: string };
}

function serverMessage(error: unknown): string {
    const data = (error as AxiosError<Record<string, unknown>>)?.response?.data;
    if (data && typeof data === 'object') {
        const first = Object.values(data)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
    }
    return 'Could not add the task. Please try again.';
}

export interface QuickAddProps {
    /** Lets the N shortcut focus the input. */
    inputRef?: Ref<HTMLInputElement>;
    /** Ctrl/⌘+Enter: open the created task in the full dialog. */
    onOpenTask?: (taskId: string) => void;
    /** ``sheet``: phone layout with tappable suggestions (UI-9). */
    variant?: 'header' | 'sheet';
}

export function QuickAdd({ inputRef, onOpenTask, variant = 'header' }: QuickAddProps) {
    const sheet = variant === 'sheet';
    const tasks = useTasks();
    const tags = useTags();
    const settings = useSettings();
    const createTask = useCreateTask();
    const client = useQueryClient();
    const now = useNow(60_000);
    const [text, setText] = useState('');
    // Tapped choices (sheet) and the ✕ on the project chip; undefined = not
    // chosen, so the active project applies. null parent = top level.
    const [pickedParent, setPickedParent] = useState<string | null | undefined>(undefined);
    const [pickedTagIds, setPickedTagIds] = useState<string[]>([]);
    const [pickedMinutes, setPickedMinutes] = useState<number | null>(null);
    const [focused, setFocused] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [hint, setHint] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [saving, setSaving] = useState(false);

    const taskList = useMemo(() => tasks.data ?? [], [tasks.data]);
    const projects = useMemo(() => projectOptions(taskList), [taskList]);
    const parsed = useMemo(() => parseQuickAdd(text, {
        now, tags: tags.data ?? [], projects: projects.map(p => ({ id: p.id, header: p.header, path: p.path })),
    }), [text, now, tags.data, projects]);

    // Never save before the active project is known: the task would silently
    // land at the top level instead of in the project.
    const ready = tasks.isSuccess && tags.isSuccess && settings.isSuccess;
    const activeId = settings.data?.active_task_id ?? null;
    const parentId = parsed.parentId ?? (pickedParent !== undefined ? pickedParent : activeId);
    const minutes = parsed.durationMinutes ?? pickedMinutes;
    const parent: Task | undefined = taskList.find(t => t.id === parentId);
    const parentPath = projects.find(p => p.id === parentId)?.path ?? parent?.header ?? null;

    const reset = () => {
        setText('');
        setPickedParent(undefined);
        setPickedTagIds([]);
        setPickedMinutes(null);
        setHint(null);
    };

    const afterSave = async (header: string) => {
        if (!parent) {
            setFeedback({ message: `Added “${header}” as a new project.`, severity: 'success' });
            return;
        }
        const fresh = await fetchTask(parent.id).catch(() => null);
        if (fresh?.over_budget && fresh.parts_total) {
            const estimate = parseDurationMinutes(fresh.duration)
                ?? parseDurationMinutes(settings.data?.default_duration ?? null) ?? 60;
            const over = (parseDurationMinutes(fresh.parts_total) ?? 0) - estimate;
            setFeedback({
                message: `${parentPath} is now ${formatDuration(minutesToDurationString(over))} over budget.`,
                severity: 'warning',
                raise: { taskId: parent.id, duration: fresh.parts_total },
            });
        } else {
            setFeedback({ message: `Added “${header}” to ${parentPath}.`, severity: 'success' });
        }
    };

    const save = async (openAfterwards: boolean) => {
        if (saving) return;
        if (!ready) {
            setHint('Still loading your projects — try again in a moment.');
            return;
        }
        if (parsed.errors.length > 0) {
            setHint('Fix the red chips first — or put a \\ before a word to keep it as text.');
            return;
        }
        if (!parsed.header) {
            setHint('Type a name for the task, e.g. “Order filament 30m”.');
            return;
        }
        setSaving(true);
        try {
            const newTags = await Promise.all(parsed.tags.new.map(name => createTag({ name })));
            if (newTags.length) client.invalidateQueries({ queryKey: queryKeys.tags });
            const typedTags = [...new Set([...parsed.tags.existing, ...newTags.map(tag => tag.id), ...pickedTagIds])];
            const body: TaskWrite = {
                header: parsed.header,
                parent_id: parentId,
                tag_ids: typedTags.length ? typedTags : parent?.tags.map(tag => tag.id) ?? [],
            };
            if (minutes !== null) body.duration = minutesToDurationString(minutes);
            const priority = parsed.priority ?? parent?.priority;
            if (priority !== undefined) body.priority = priority;
            if (parsed.deadline) body.latest_finish_date = parsed.deadline.toISOString();
            const created = await createTask.mutateAsync(body);
            if (parentId) rememberRecent(RECENT_PROJECTS, parentId);
            for (const id of [...typedTags].reverse()) rememberRecent(RECENT_TAGS, id, 8);
            reset();
            if (openAfterwards) onOpenTask?.(created.id);
            await afterSave(parsed.header);
        } catch (error) {
            setHint(serverMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const raiseEstimate = async (raise: NonNullable<Feedback['raise']>) => {
        setFeedback(null);
        await updateTask(raise.taskId, { duration: raise.duration, estimate_reason: 'raised_from_warning' });
        client.invalidateQueries({ queryKey: queryKeys.tasks });
        client.invalidateQueries({ queryKey: queryKeys.plan });
    };

    const showChips = focused && text.trim() !== '';
    // Small lists; recomputed each render so fresh recents show after a save.
    const suggestedProjects = sheet ? suggestProjects(projects, readRecent(RECENT_PROJECTS)) : [];
    const suggestedTags = sheet ? suggestTags(tags.data ?? [], taskList, readRecent(RECENT_TAGS)) : [];
    const errorMessages = parsed.tokens.filter(t => t.kind === 'error').map(t => t.message!);

    const input = (
        <TextField
            inputRef={inputRef}
            size={sheet ? 'medium' : 'small'} fullWidth
            autoFocus={sheet}
            placeholder={sheet ? 'What needs doing?  e.g. Call landlord' : 'Add task…  e.g. Order filament 30m #maker >fri'}
            value={text}
            onChange={event => { setText(event.target.value); setHint(null); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    save(event.ctrlKey || event.metaKey);
                } else if (event.key === 'Escape' && !sheet) {
                    // In the sheet, Escape closes the sheet instead.
                    reset();
                    (event.target as HTMLInputElement).blur();
                }
            }}
            slotProps={{
                htmlInput: {
                    'aria-label': 'Add task', 'aria-invalid': errorMessages.length > 0,
                    enterKeyHint: sheet ? 'done' : undefined,
                },
                input: sheet ? undefined : {
                    endAdornment: (
                        <Typography variant="caption" color="text.disabled"
                            sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5, px: 0.5 }}>
                            N
                        </Typography>
                    ),
                },
            }}
        />
    );

    // How the text was understood: target project first, then the tokens.
    const chips = (
        <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                    <Chip
                        data-testid="quick-add-project" size="small"
                        label={!ready ? 'Loading…' : parentPath ? `● ${parentPath}` : 'New project (top level)'}
                        variant={parentPath ? 'filled' : 'outlined'}
                    />
                    {!sheet && ready && parentPath && parsed.parentId === null && (
                        <IconButton size="small" aria-label="no project for this task"
                            title="Add this task as a new project instead" onClick={() => setPickedParent(null)}>
                            <CloseIcon fontSize="inherit" />
                        </IconButton>
                    )}
                </Box>
                {parsed.tokens.map(token => (
                    <Chip key={token.start} size="small"
                        color={token.kind === 'error' ? 'error' : token.kind === 'newTag' ? 'secondary' : 'default'}
                        variant={token.kind === 'error' ? 'filled' : 'outlined'}
                        label={`${TOKEN_ICON[token.kind] ?? ''}${token.label}`}
                        title={token.message}
                    />
                ))}
            </Box>
            {errorMessages.map(message => (
                <Typography key={message} variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
                    {message}
                </Typography>
            ))}
            {hint && (
                <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 0.5 }}>
                    {hint}
                </Typography>
            )}
        </>
    );

    const snackbar = (
    <Snackbar open={feedback !== null} autoHideDuration={feedback?.raise ? 10000 : 4000}
        onClose={() => setFeedback(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert
            severity={feedback?.severity ?? 'success'} variant="filled" onClose={() => setFeedback(null)}
            action={feedback?.raise ? (
                <Button color="inherit" size="small" onClick={() => raiseEstimate(feedback.raise!)}>
                    Raise estimate
                </Button>
            ) : undefined}
        >
            {feedback?.message}
        </Alert>
    </Snackbar>
    );

    if (sheet) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {input}
                {/* Keep the input focused (and the phone keyboard open) on taps. */}
                <Box onMouseDown={event => event.preventDefault()}>{chips}</Box>
                <QuickAddSuggestions
                    projects={suggestedProjects.map(p => ({ id: p.id, label: p.header }))}
                    parentId={parentId}
                    onParent={id => { setPickedParent(id); setHint(null); }}
                    tags={suggestedTags}
                    tagIds={[...parsed.tags.existing, ...pickedTagIds]}
                    onToggleTag={id => setPickedTagIds(prev => (prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]))}
                    minutes={minutes}
                    onMinutes={setPickedMinutes}
                />
                <Button variant="contained" size="large" disabled={saving}
                    onMouseDown={event => event.preventDefault()} onClick={() => save(false)}>
                    Add
                </Button>
                {snackbar}
            </Box>
        );
    }

    return (
        <Box ref={setAnchor} sx={{ flex: 1, minWidth: 180, maxWidth: 560 }}>
            {input}
            <Popper open={showChips && anchor !== null} anchorEl={anchor} placement="bottom-start"
                sx={{ zIndex: 'modal', width: anchor?.clientWidth }}>
                {/* Keep the input focused when chips are clicked. */}
                <Paper elevation={6} sx={{ p: 1, mt: 0.5 }} onMouseDown={event => event.preventDefault()}>
                    {chips}
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                        Enter adds · Ctrl+Enter adds and opens details · Esc clears
                    </Typography>
                </Paper>
            </Popper>
            {snackbar}
        </Box>
    );
}
