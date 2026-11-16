/**
 * Sorting tracked time afterwards (docs/sort-time.md): a stretch whose split
 * between tasks is decided later — a session that covered several tasks,
 * time begun with "Start work", or a gap in the time sheet. Tick what was
 * done (☑, a second tap: worked on ◐), or type a task to add it done; the
 * stretch is shared out by estimates, minutes typed for a row are pinned.
 *
 * Fast with the keyboard: type to find, Enter ticks the first match (or adds
 * the text as a done task), Enter on nothing saves; ↓/↑ move through the
 * rows, Space ticks. Saving asks nothing: Undo comes in a snackbar.
 *
 * ``SortTimeProvider`` holds the sheet and its Undo for the whole app;
 * ``useOpenSortTime()`` (sortTimeContext.ts) opens it (the tracker, the
 * time sheet).
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar, TextField, Tooltip,
    Typography,
} from '@mui/material';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox';
import { isAxiosError } from 'axios';

import {
    useSettings, useSortTime, useTags, useTasks, useUndoSortTime, useWorkBlockSuggestions,
} from '../../queries.tsx';
import type { SuggestionReason, Task, WorkBlock, WorkBlockTick } from '../../types.ts';
import { SortTimeContext, type SortTarget } from './sortTimeContext.ts';
import { formatDuration, minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import { parseQuickAdd } from '../../utils/quickAdd.ts';
import { projectOptions } from '../../utils/projects.ts';
import { TASK_COLOR_PALETTE } from '../../utils/taskColors.ts';
import { shares, weightMinutes, type ShareInput } from '../../utils/workBlocks.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';


type State = 'none' | 'done' | 'worked';
const NEXT: Record<State, State> = { none: 'done', done: 'worked', worked: 'none' };
const CHECKED: Record<State, 'true' | 'false' | 'mixed'> = { none: 'false', done: 'true', worked: 'mixed' };

interface NewTask { header: string; durationMinutes: number | null; parentId: string | null; tagIds: string[] }

/** A row of the sheet: a task (its id) or one added here (``new:…``). */
interface Row { key: string; task?: Task; created?: NewTask; reason?: SuggestionReason }

const spoken = (seconds: number) => formatDuration(minutesToDurationString(Math.round(seconds / 60)));
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const duration = (minutes: number | null) => (minutes === null ? null : minutesToDurationString(minutes));

function spanOf(target: SortTarget): { start: string; end: string } {
    if ('gap' in target) return target.gap;
    const item = 'block' in target ? target.block : target.session;
    return { start: item.start, end: item.end ?? new Date().toISOString() };
}

/** Seconds of this stretch already booked on a task: not "time spent elsewhere". */
function ownSeconds(target: SortTarget, taskId: string): number {
    if ('session' in target) return target.session.task_id === taskId ? target.session.seconds : 0;
    if ('block' in target) return target.block.items.find(item => item.task_id === taskId)?.seconds ?? 0;
    return 0;
}

interface SheetProps {
    target: SortTarget;
    onClose: () => void;
    onSorted: (block: WorkBlock) => void;
}

function SortTimeSheet({ target, onClose, onSorted }: SheetProps) {
    const tasks = useTasks();
    const tags = useTags();
    const settings = useSettings();
    const sort = useSortTime();
    const phone = useIsMobile();
    const span = spanOf(target);
    const trackedId = 'session' in target ? target.session.task_id
        : 'block' in target ? target.block.original_task_id ?? undefined : undefined;
    const suggestions = useWorkBlockSuggestions({ ...span, ...(trackedId ? { task: trackedId } : {}) });
    const byId = useMemo(() => new Map((tasks.data ?? []).map(task => [task.id, task])), [tasks.data]);
    const defaultMinutes = parseDurationMinutes(settings.data?.default_duration ?? null) ?? 60;
    const totalSeconds = Math.max(0, Math.round((new Date(span.end).getTime() - new Date(span.start).getTime()) / 1000));

    // What was ticked when the sheet opened: the session's task, or the block's rows.
    const [states, setStates] = useState<Record<string, State>>(() => {
        if ('session' in target) return { [target.session.task_id]: 'done' };
        if ('block' in target) {
            return Object.fromEntries(target.block.items.map(item => [item.task_id, item.completed ? 'done' : 'worked']));
        }
        return {};
    });
    const [pinned, setPinned] = useState<Record<string, number | null>>(() => ('block' in target
        ? Object.fromEntries(target.block.items.map(item => [item.task_id, item.pinned_minutes])) : {}));
    const [initial] = useState<string[]>(() => ('session' in target ? [target.session.task_id]
        : 'block' in target ? target.block.items.map(item => item.task_id) : []));
    const [added, setAdded] = useState<string[]>([]);
    const [created, setCreated] = useState<Record<string, NewTask>>({});
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const rowRefs = useRef<(HTMLElement | null)[]>([]);
    const findRef = useRef<HTMLInputElement | null>(null);

    const reasons = useMemo(() => new Map((suggestions.data ?? []).map(s => [s.task_id, s.reason])), [suggestions.data]);
    const rows: Row[] = useMemo(() => {
        const keys = [...new Set([...initial, ...(suggestions.data ?? []).map(s => s.task_id), ...added])];
        return keys.flatMap((key): Row[] => {
            if (created[key]) return [{ key, created: created[key] }];
            const task = byId.get(key);
            return task ? [{ key, task, reason: reasons.get(key) }] : [];
        });
    }, [initial, added, created, byId, reasons, suggestions.data]);

    const query = text.trim().toLowerCase();
    const projects = useMemo(() => projectOptions(tasks.data ?? []), [tasks.data]);
    const parsed = useMemo(() => parseQuickAdd(text, { now: new Date(), tags: tags.data ?? [], projects }),
        [text, tags.data, projects]);
    const plainSearch = parsed.tokens.length === 0;
    const matches: Row[] = useMemo(() => {
        if (!query) return [];
        const shown = rows.filter(row => label(row).toLowerCase().includes(query));
        const others = (tasks.data ?? [])
            .filter(task => !task.is_done && !task.children_ids?.length && !task.is_appointment
                && !rows.some(row => row.key === task.id) && task.header.toLowerCase().includes(query))
            .slice(0, 6)
            .map(task => ({ key: task.id, task }));
        return [...shown, ...others];
    }, [query, rows, tasks.data]);
    const visible = query ? matches : rows;

    const ticked = rows.filter(row => (states[row.key] ?? 'none') !== 'none');
    const inputs: ShareInput[] = ticked.map(row => ({
        estimateMinutes: row.created ? row.created.durationMinutes ?? defaultMinutes
            : parseDurationMinutes(row.task!.duration) ?? defaultMinutes,
        spentElsewhereMinutes: row.task
            ? Math.max(0, (parseDurationMinutes(row.task.time_spent) ?? 0) - ownSeconds(target, row.key) / 60) : 0,
        completed: states[row.key] === 'done',
        pinnedMinutes: pinned[row.key] ?? null,
    }));
    const result = shares(totalSeconds, inputs);
    const shareOf = new Map(ticked.map((row, index) => [row.key, 'seconds' in result ? result.seconds[index] : 0]));
    const freeWeight = inputs.filter(input => input.pinnedMinutes === null).reduce((sum, input) => sum + weightMinutes(input), 0);
    const pinnedSeconds = inputs.reduce((sum, input) => sum + (input.pinnedMinutes ?? 0) * 60, 0);
    const factor = freeWeight > 0 ? (totalSeconds - pinnedSeconds) / 60 / freeWeight : null;

    const cycle = (key: string) => setStates(current => ({ ...current, [key]: NEXT[current[key] ?? 'none'] }));
    const tickRow = (row: Row) => {
        if (!rows.some(shown => shown.key === row.key)) setAdded(current => [...current, row.key]);
        setStates(current => ({ ...current, [row.key]: 'done' }));
    };
    const addNew = () => {
        const key = `new:${added.length}:${parsed.header}`;
        setCreated(current => ({ ...current, [key]: {
            header: parsed.header, durationMinutes: parsed.durationMinutes,
            parentId: parsed.parentId ?? settings.data?.active_task_id ?? null, tagIds: parsed.tags.existing,
        } }));
        setAdded(current => [...current, key]);
        setStates(current => ({ ...current, [key]: 'done' }));
    };

    const canSave = ticked.length > 0 && 'seconds' in result && !sort.isPending;
    const save = () => {
        if (!canSave) return;
        const items: WorkBlockTick[] = ticked.map(row => ({
            ...(row.created
                ? { new: { header: row.created.header, duration: duration(row.created.durationMinutes),
                    parent_id: row.created.parentId, tag_ids: row.created.tagIds } }
                : { task_id: row.key }),
            completed: states[row.key] === 'done',
            pinned_minutes: pinned[row.key] ?? null,
        }));
        const request = 'block' in target ? { blockId: target.block.id, items }
            : 'session' in target ? { session_id: target.session.id, items }
                : { start: span.start, end: span.end, items };
        setError(null);
        sort.mutate(request, {
            onSuccess: onSorted,
            onError: failure => setError(isAxiosError(failure) && failure.response?.data?.detail
                ? String(failure.response.data.detail) : 'Could not save. Try again.'),
        });
    };

    const onFindKey = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            rowRefs.current[0]?.focus();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (!query) { save(); return; }
            if (plainSearch && matches.length > 0) tickRow(matches[0]);
            else if (parsed.header) addNew();
            setText('');
        }
    };
    const onRowKey = (event: React.KeyboardEvent, index: number, row: Row) => {
        if (event.key === ' ') { event.preventDefault(); cycle(row.key); }
        if (event.key === 'ArrowDown') { event.preventDefault(); rowRefs.current[index + 1]?.focus(); }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            (index === 0 ? findRef.current : rowRefs.current[index - 1])?.focus();
        }
    };

    const title = `Sort ${clock(span.start)} – ${clock(span.end)} · ${spoken(totalSeconds)}`;
    return (
        <Dialog open onClose={onClose} fullScreen={phone} fullWidth maxWidth="sm" aria-labelledby="sort-time-title"
            onKeyDown={event => {
                // Enter saves from anywhere but a button (Cancel stays Cancel).
                if (event.key === 'Enter' && !event.defaultPrevented && !(event.target instanceof HTMLButtonElement)) {
                    event.preventDefault();
                    save();
                }
            }}>
            <DialogTitle id="sort-time-title">{title}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {/* One bar, a colour per ticked task: how the stretch is shared. */}
                <Box aria-hidden sx={{ display: 'flex', height: 12, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
                    {ticked.map((row, index) => (
                        <Box key={row.key} sx={{ flexGrow: shareOf.get(row.key) ?? 0, flexBasis: 0 }}
                            style={{ backgroundColor: row.task?.hex_color ?? TASK_COLOR_PALETTE[index % TASK_COLOR_PALETTE.length].hex }} />
                    ))}
                </Box>
                <TextField size="small" autoFocus value={text} placeholder="e.g. Fix login redirect 45m #Arbeit"
                    label="Find or add a done task" onChange={event => setText(event.target.value)}
                    helperText={query ? (plainSearch && matches.length ? 'Enter ticks the first match' : `Enter adds “${parsed.header}”, done`)
                        : 'Enter saves · ↓ to the list, Space ticks (twice: worked on)'}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { role: 'combobox', 'aria-expanded': Boolean(query),
                        ref: findRef, onKeyDown: onFindKey } }} />
                <Box role="list" sx={{ display: 'flex', flexDirection: 'column' }}>
                    {visible.map((row, index) => {
                        const state = states[row.key] ?? 'none';
                        const name = label(row);
                        const seconds = shareOf.get(row.key);
                        return (
                            <Box role="listitem" key={row.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                <Box role="checkbox" aria-checked={CHECKED[state]} aria-label={name} tabIndex={0}
                                    ref={(element: HTMLElement | null) => { rowRefs.current[index] = element; }}
                                    onClick={() => cycle(row.key)} onKeyDown={event => onRowKey(event, index, row)}
                                    sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0, cursor: 'pointer',
                                        borderRadius: 1, px: 0.5, '&:focus-visible': { outline: 2, outlineColor: 'primary.main' } }}>
                                    {state === 'done' ? <CheckBoxIcon color="primary" />
                                        : state === 'worked' ? <IndeterminateCheckBoxIcon color="primary" />
                                            : <CheckBoxOutlineBlankIcon color="action" />}
                                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{name}</Typography>
                                    {row.created && <Chip size="small" label="new" />}
                                    {row.reason && <Typography variant="caption" color="text.secondary" noWrap>{row.reason}</Typography>}
                                </Box>
                                {/* Fixed columns: estimate, share, minutes — unticked rows keep their place. */}
                                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', width: 64, textAlign: 'right' }}>
                                    est {formatDuration(row.created ? duration(row.created.durationMinutes)
                                        : row.task!.duration) }
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: 136, justifyContent: 'flex-end' }}>
                                    {seconds !== undefined && (
                                        <>
                                            <Typography data-testid={`share-${name}`} variant="body2"
                                                sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                                {spoken(seconds)}
                                            </Typography>
                                            <Tooltip describeChild title="Minutes for it (pinned; the rest is shared out)">
                                                <TextField size="small" type="number" value={pinned[row.key] ?? ''}
                                                    placeholder={String(Math.round(seconds / 60))}
                                                    onChange={event => setPinned(current => ({ ...current,
                                                        [row.key]: event.target.value === '' ? null : Math.max(0, Math.round(Number(event.target.value))) }))}
                                                    sx={{ width: 64, '& input': { py: 0.5, px: 1 } }}
                                                    slotProps={{ htmlInput: { 'aria-label': `Minutes for ${name}`, min: 0 } }} />
                                            </Tooltip>
                                        </>
                                    )}
                                </Box>
                            </Box>
                        );
                    })}
                    {suggestions.isPending && rows.length === 0 && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
                </Box>
                {'error' in result && <Alert severity="error">{result.error}</Alert>}
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
                <Typography variant="caption" color="text.secondary">
                    {factor !== null && ticked.length > 0 ? `Estimates × ${factor.toFixed(2)} to fill ${spoken(totalSeconds - pinnedSeconds)}` : ''}
                </Typography>
                <Box>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button variant="contained" onClick={save} disabled={!canSave}>Save ⏎</Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
}

function label(row: Row): string {
    return row.created ? row.created.header : row.task!.header;
}

/** The sort sheet and its Undo, for the whole app. */
export function SortTimeProvider({ children }: { children: ReactNode }) {
    const [target, setTarget] = useState<SortTarget | null>(null);
    // A new sheet each time: its ticks start from the target.
    const [opened, setOpened] = useState(0);
    const [done, setDone] = useState<WorkBlock | null>(null);
    const undo = useUndoSortTime();
    const open = useCallback((next: SortTarget) => {
        setTarget(next);
        setOpened(count => count + 1);
    }, []);
    const count = done?.items.length ?? 0;
    return (
        <SortTimeContext.Provider value={open}>
            {children}
            {target && (
                <SortTimeSheet key={opened} target={target} onClose={() => setTarget(null)}
                    onSorted={block => { setTarget(null); setDone(block); }} />
            )}
            <Snackbar open={done !== null} autoHideDuration={8000} onClose={() => setDone(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                message={done ? `Sorted ${spoken(done.seconds)} into ${count} task${count === 1 ? '' : 's'}.` : ''}
                action={done && (
                    <Button color="inherit" size="small" onClick={() => { undo.mutate(done.id); setDone(null); }}>
                        Undo
                    </Button>
                )} />
        </SortTimeContext.Provider>
    );
}
