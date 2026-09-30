/**
 * UI-7: the outline — since T-2 the Tasks tab (docs/task-entry-ui.md §5,
 * docs/tasks-tab.md). "+ New task" opens the full dialog for a new task.
 *
 * The tree of open tasks, edited in place (every change is saved at once).
 * Keyboard: ↑/↓ select · →/← expand/collapse · Enter (or a click) opens the
 * edit dialog (T-4; ↑/↓ inside walk to the neighbouring tasks, like Todoist)
 * · Tab / Shift+Tab re-parent · Alt+↑/↓
 * reorder · 0–9 priority · E estimate · M move · # tag · S split ·
 * Space track · Del delete (with undo).
 *
 * T-3 (docs/tasks-tab.md): one tree of every project — the active project's
 * top-level task first, its path opened, the active node marked; collapsed
 * rows and "Show completed" remembered per browser; a circle per row
 * completes the task (Undo in the toast, like Todoist/Wunderlist); "+ Add
 * task" at the end of every expanded project and of the tree.
 * "Sort" switches to the sorting session: the inbox of unestimated tasks
 * from all projects.
 *
 * Touch screens (UI-9): the selected row gets buttons for what lives on keys
 * — outdent, indent, move, details (no double-click on a phone), split.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
    IconButton, Snackbar, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FormatIndentDecreaseIcon from '@mui/icons-material/FormatIndentDecrease';
import FormatIndentIncreaseIcon from '@mui/icons-material/FormatIndentIncrease';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import EditIcon from '@mui/icons-material/Edit';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import AddIcon from '@mui/icons-material/Add';
import type { AxiosError } from 'axios';

import { ProjectPicker, type ProjectPick } from '../ProjectPicker/ProjectPicker.tsx';
import { SplitEditor } from '../SplitEditor/SplitEditor.tsx';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';
import { parseDurationInput } from '../TaskFormDialog/taskFormValidation.ts';
import { createTag, deleteTask as deleteTaskRequest } from '../../api.ts';
import {
    useCompleteTask, useCreateTask, useDeleteTask, useReopenTask, useSettings, useStartTracking, useTags, useTasks,
    useUpdateTask,
} from '../../queries.tsx';
import { commitRowTokens, newRow } from '../../utils/outline.ts';
import {
    inboxItems, indentParent, outdentParent, outlineItems, reorderPatches, type OutlineItem,
} from '../../utils/outlineTree.ts';
import { projectOptions } from '../../utils/projects.ts';
import { readCollapsed, readShowCompleted, storeCollapsed, storeShowCompleted } from '../../utils/taskTreePrefs.ts';
import { formatDuration, minutesToDurationString } from '../../utils/duration.ts';
import type { Task, TaskWrite } from '../../types.ts';
import { useIsMobile, useIsTouch } from '../../hooks/useResponsive.ts';

const human = (duration: string | null) => formatDuration(duration);
const END_OF_TREE = 'add:top';
const itemName = (item: OutlineItem) => (item.kind === 'rest' ? `Rest of ${item.task.header}` : item.task.header);

type Editing = { key: string; field: 'header' | 'estimate'; text: string; error?: string };
type Draft = { parentId: string | null; depth: number; afterKey: string; text: string; error?: string };

function serverMessage(error: unknown): string {
    const data = (error as AxiosError<Record<string, unknown>>)?.response?.data;
    const first = data && typeof data === 'object' ? Object.values(data)[0] : null;
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
    return typeof first === 'string' ? first : 'The change could not be saved.';
}

export interface OutlineViewProps {
    /** How long a deleted row can be restored (undo) before it is deleted. */
    deleteDelayMs?: number;
}

export function OutlineView({ deleteDelayMs = 6000 }: OutlineViewProps) {
    const tasks = useTasks();
    const tags = useTags();
    const settings = useSettings();
    const updateTask = useUpdateTask();
    const createTask = useCreateTask();
    const deleteTask = useDeleteTask();
    const startTracking = useStartTracking();
    const completeTask = useCompleteTask();
    const reopenTask = useReopenTask();

    const [sortMode, setSortMode] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
    const [showCompleted, setShowCompleted] = useState(readShowCompleted);
    const [completedToast, setCompletedToast] = useState<{ id: string; text: string } | null>(null);
    // The active project whose path was last opened (see below).
    const [openedFor, setOpenedFor] = useState<string | null>(null);
    const [selection, setSelection] = useState<{ key: string; index: number } | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [pendingDeletes, setPendingDeletes] = useState<Map<string, string>>(() => new Map());
    const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
    const [splitTask, setSplitTask] = useState<Task | null>(null);
    // The task in the edit dialog, by id: after a save it shows the fresh data.
    const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [move, setMove] = useState<{ task: Task; anchor: HTMLElement } | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const container = useRef<HTMLDivElement>(null);
    const rowElements = useRef(new Map<string, HTMLElement>());
    const deleteTimers = useRef(new Map<string, number>());

    // Deletes still waiting for their undo window run when the view goes.
    useEffect(() => {
        const timers = deleteTimers.current;
        return () => {
            for (const [id, timer] of timers) {
                window.clearTimeout(timer);
                deleteTaskRequest(id).catch(() => undefined);
            }
        };
    }, []);

    const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
    const visibleTasks = useMemo(() => allTasks.filter(t => !pendingDeletes.has(t.id)), [allTasks, pendingDeletes]);
    const activeId = settings.data?.active_task_id ?? null;

    // When the active project changes, open the path down to it (once — the
    // user may collapse it again). Adjusting state while rendering, as React
    // recommends for state derived from a changed value.
    if (activeId !== openedFor && tasks.data) {
        setOpenedFor(activeId);
        const path = allTasks.find(t => t.id === activeId)?.ancestor_ids ?? [];
        if (path.some(id => collapsed.has(id))) {
            setCollapsed(prev => new Set([...prev].filter(id => !path.includes(id))));
        }
    }

    const items = useMemo(() => (sortMode
        ? inboxItems(visibleTasks)
        : outlineItems(visibleTasks, { activeId, collapsed, showCompleted })),
    [sortMode, visibleTasks, activeId, collapsed, showCompleted]);
    const inboxCount = useMemo(() => inboxItems(visibleTasks).length, [visibleTasks]);
    const defaultDuration = settings.data?.default_duration ?? '01:00:00';
    const context = useMemo(() => ({ now: new Date(), tags: tags.data ?? [], projects: [] }), [tags.data]);

    // The selected row; when it disappears (e.g. estimated in the inbox),
    // the row now at its position is selected.
    const selectedIndex = (() => {
        if (items.length === 0) return -1;
        if (!selection) return sortMode ? 0 : -1; // the sorting session starts at the top
        const found = items.findIndex(i => i.key === selection.key);
        return found >= 0 ? found : Math.min(selection.index, items.length - 1);
    })();
    const selected = selectedIndex >= 0 ? items[selectedIndex] : null;
    const touch = useIsTouch();
    const mobile = useIsMobile();
    const rowButtons = touch || mobile;

    const select = (index: number) => {
        const item = items[Math.max(0, Math.min(index, items.length - 1))];
        if (!item) return;
        setSelection({ key: item.key, index: items.indexOf(item) });
        rowElements.current.get(item.key)?.scrollIntoView?.({ block: 'nearest' });
    };
    const refocus = () => container.current?.focus();

    const patch = (task: Task, body: TaskWrite) =>
        updateTask.mutateAsync({ taskId: task.id, patch: body }).catch(error => {
            setMessage(serverMessage(error));
            throw error;
        });

    /** Changes to the collapsed rows are remembered per browser. */
    const updateCollapsed = (change: (next: Set<string>) => void) => setCollapsed(prev => {
        const next = new Set(prev);
        change(next);
        storeCollapsed(next);
        return next;
    });
    const toggleCollapsed = (id: string) => updateCollapsed(next => {
        if (next.has(id)) next.delete(id); else next.add(id);
    });

    const toggleShowCompleted = (show: boolean) => {
        setShowCompleted(show);
        storeShowCompleted(show);
    };

    /** The circle: complete (Undo in the toast) or, for a completed row, reopen. */
    const toggleDone = (task: Task) => {
        if (task.is_done) {
            reopenTask.mutate(task.id, { onError: error => setMessage(serverMessage(error)) });
            return;
        }
        completeTask.mutate(task.id, {
            onSuccess: data => {
                const topmost = data.auto_completed?.[data.auto_completed.length - 1];
                setCompletedToast({
                    id: task.id,
                    text: `Completed “${task.header}”${topmost ? ` — “${topmost.header}” completed too` : ''}`,
                });
            },
            onError: error => setMessage(serverMessage(error)),
        });
    };

    const undoComplete = () => {
        if (!completedToast) return;
        // Reopening the task reopens the parents that completed along (UI-2).
        reopenTask.mutate(completedToast.id, { onError: error => setMessage(serverMessage(error)) });
        setCompletedToast(null);
    };

    const startSort = () => {
        setSortMode(true);
        setEditing(null);
        setDraft(null);
        const first = inboxItems(visibleTasks)[0];
        setSelection(first ? { key: first.key, index: 0 } : null);
        refocus();
    };

    // ---------------------------------------------------------- actions

    const reparent = (task: Task, parentId: string | null | undefined) => {
        if (parentId === undefined || parentId === task.parent_id) return;
        patch(task, { parent_id: parentId }).then(() => {
            if (parentId) updateCollapsed(next => { next.delete(parentId); });
        }).catch(() => undefined);
    };

    const reorder = (task: Task, direction: -1 | 1) => {
        const changes = reorderPatches(task, visibleTasks, direction);
        changes.reduce<Promise<unknown>>((chain, change) => chain.then(() => {
            const target = visibleTasks.find(t => t.id === change.id)!;
            return patch(target, { order: change.order });
        }), Promise.resolve()).catch(() => undefined);
    };

    const requestDelete = (task: Task) => {
        if (task.children_ids?.length) {
            setConfirmDelete(task);
            return;
        }
        setPendingDeletes(prev => new Map(prev).set(task.id, task.header));
        deleteTimers.current.set(task.id, window.setTimeout(() => {
            deleteTimers.current.delete(task.id);
            deleteTask.mutate({ taskId: task.id }, {
                onSettled: () => setPendingDeletes(prev => { const next = new Map(prev); next.delete(task.id); return next; }),
                onError: error => setMessage(serverMessage(error)),
            });
        }, deleteDelayMs));
    };

    const undoDelete = () => {
        const last = [...pendingDeletes.keys()].pop();
        if (!last) return;
        window.clearTimeout(deleteTimers.current.get(last));
        deleteTimers.current.delete(last);
        setPendingDeletes(prev => { const next = new Map(prev); next.delete(last); return next; });
    };

    const deleteParent = (task: Task, children: 'lift' | 'delete') => {
        setConfirmDelete(null);
        deleteTask.mutate({ taskId: task.id, children }, { onError: error => setMessage(serverMessage(error)) });
    };

    const pickMove = (pick: ProjectPick) => {
        if (!move) return;
        if (pick.kind === 'project') reparent(move.task, pick.id);
        else if (pick.kind === 'none') reparent(move.task, null);
        setMove(null);
        refocus();
    };

    /** Turn typed tokens into a task write (tags are created if new). */
    const tokensToWrite = async (text: string): Promise<{ write: TaskWrite; header: string } | { error: string }> => {
        const row = commitRowTokens({ ...newRow(0), header: text }, context);
        if (row.error) return { error: row.error };
        const created = await Promise.all((row.newTags ?? []).map(name => createTag({ name })));
        const write: TaskWrite = {};
        if (row.minutes !== null) write.duration = minutesToDurationString(row.minutes);
        const tagIds = [...(row.tagIds ?? []), ...created.map(tag => tag.id)];
        if (tagIds.length) write.tag_ids = tagIds;
        if (row.priority !== undefined) write.priority = row.priority;
        if (row.deadline) write.latest_finish_date = row.deadline;
        return { write, header: row.header.trim() };
    };

    const commitEdit = async () => {
        if (!editing) return;
        const item = items.find(i => i.key === editing.key);
        if (!item || item.kind !== 'task') { setEditing(null); return; }
        const task = item.task;
        if (editing.field === 'estimate') {
            const parsed = parseDurationInput(editing.text);
            if (parsed.kind === 'invalid' || (parsed.kind === 'ok' && parsed.minutes <= 0)) {
                setEditing({ ...editing, error: `“${editing.text}” is not a duration. Use e.g. 45m, 1.5 or 1:30 — or leave it empty for your default.` });
                return;
            }
            const duration = parsed.kind === 'ok' ? minutesToDurationString(parsed.minutes) : null;
            setEditing(null);
            refocus();
            if (duration !== task.duration) await patch(task, { duration }).catch(() => undefined);
            return;
        }
        const result = await tokensToWrite(editing.text);
        if ('error' in result) { setEditing({ ...editing, error: result.error }); return; }
        if (!result.header) { setEditing({ ...editing, error: 'The header is empty. Type a name for the task.' }); return; }
        const body: TaskWrite = { ...result.write };
        if (result.header !== task.header) body.header = result.header;
        if (body.tag_ids) body.tag_ids = [...new Set([...task.tags.map(t => t.id), ...body.tag_ids])];
        setEditing(null);
        refocus();
        if (Object.keys(body).length) await patch(task, body).catch(() => undefined);
    };

    const commitDraft = async () => {
        if (!draft) return;
        if (!draft.text.trim()) { setDraft(null); refocus(); return; }
        const result = await tokensToWrite(draft.text);
        if ('error' in result) { setDraft({ ...draft, error: result.error }); return; }
        if (!result.header) { setDraft({ ...draft, error: 'Type a name for the task.' }); return; }
        const parent = draft.parentId ? allTasks.find(t => t.id === draft.parentId) : undefined;
        const body: TaskWrite = { header: result.header, parent_id: draft.parentId, ...result.write };
        // Like quick add: new tasks inherit the parent's tags and priority.
        if (!body.tag_ids && parent?.tags.length) body.tag_ids = parent.tags.map(t => t.id);
        if (body.priority === undefined && parent) body.priority = parent.priority;
        setDraft({ ...draft, text: '', error: undefined });
        createTask.mutate(body, { onError: error => setMessage(serverMessage(error)) });
    };

    const beginEdit = (item: OutlineItem, field: Editing['field'], suffix = '') => {
        if (item.kind !== 'task') return;
        const text = field === 'header' ? item.task.header + suffix
            : item.task.duration ? human(item.task.duration).replace(/ /g, '') : '';
        setEditing({ key: item.key, field, text });
    };

    // ----------------------------------------------------------- keyboard

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== container.current) return; // inputs handle their own keys
        const key = event.key;
        if (key === 'ArrowDown' && !event.altKey) { event.preventDefault(); select(selectedIndex + 1); return; }
        if (key === 'ArrowUp' && !event.altKey) { event.preventDefault(); select(Math.max(0, selectedIndex - 1)); return; }
        if (!selected) return;
        const task = selected.task;
        const isTask = selected.kind === 'task';

        if (key === 'Enter') {
            event.preventDefault();
            if (!isTask) setSplitTask(task);
            else setDialogTaskId(task.id); // T-4: Enter opens the full dialog
        } else if (key === ' ') {
            event.preventDefault();
            startTracking.mutate(task.id, { onError: error => setMessage(serverMessage(error)) });
        } else if (key === 's' || key === 'S') {
            event.preventDefault();
            setSplitTask(task);
        } else if (!isTask) {
            return;
        } else if (key === 'ArrowRight' && selected.kind === 'task' && selected.hasChildren) {
            event.preventDefault();
            updateCollapsed(next => { next.delete(task.id); });
        } else if (key === 'ArrowLeft' && selected.kind === 'task') {
            event.preventDefault();
            if (selected.hasChildren && selected.expanded) updateCollapsed(next => { next.add(task.id); });
            else if (task.parent_id) select(items.findIndex(i => i.key === task.parent_id));
        } else if (key === 'Tab' && !sortMode) {
            event.preventDefault();
            reparent(task, event.shiftKey ? outdentParent(task, visibleTasks) : indentParent(task, visibleTasks) ?? undefined);
        } else if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown') && !sortMode) {
            event.preventDefault();
            reorder(task, key === 'ArrowUp' ? -1 : 1);
        } else if (/^[0-9]$/.test(key)) {
            event.preventDefault();
            patch(task, { priority: Number(key) }).catch(() => undefined);
        } else if (key === 'e' || key === 'E') {
            event.preventDefault();
            beginEdit(selected, 'estimate');
        } else if (key === '#') {
            event.preventDefault();
            beginEdit(selected, 'header', ' #');
        } else if (key === 'm' || key === 'M') {
            event.preventDefault();
            const anchor = rowElements.current.get(selected.key);
            if (anchor) setMove({ task, anchor });
        } else if (key === 'Delete') {
            event.preventDefault();
            requestDelete(task);
        }
    };

    // ------------------------------------------------------------- render

    // Inline inputs keep their keys to themselves (not the outline's).
    const onEditKeyDown = (event: React.KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); commitEdit(); }
        if (event.key === 'Escape') { event.preventDefault(); setEditing(null); refocus(); }
    };
    const onDraftKeyDown = (event: React.KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(null); refocus(); }
    };

    const renderDraft = () => draft && (
        <Box key="draft" sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 + draft.depth * 3 + 4.5, pr: 1, py: 0.5 }}>
            <TextField size="small" fullWidth autoFocus value={draft.text} error={Boolean(draft.error)}
                helperText={draft.error ?? 'Enter adds the task (e.g. “assembly 2h #maker”), Esc stops'}
                placeholder="New task…"
                onChange={event => setDraft({ ...draft, text: event.target.value, error: undefined })}
                onKeyDown={onDraftKeyDown}
                onBlur={() => { if (draft && !draft.text.trim()) setDraft(null); }}
                slotProps={{ htmlInput: { 'aria-label': 'New task' } }} />
        </Box>
    );

    const lastPending = [...pendingDeletes.entries()].pop();

    // T-4: the dialog walks the task rows in tree order (Rest rows are not
    // tasks); the selection follows so closing lands on the last one shown.
    const dialogTask = dialogTaskId ? allTasks.find(t => t.id === dialogTaskId) ?? null : null;
    const taskItems = items.filter(i => i.kind === 'task');
    const dialogPosition = taskItems.findIndex(i => i.task.id === dialogTaskId);
    const openNeighbour = (direction: -1 | 1) => {
        const target = taskItems[dialogPosition + direction];
        if (!target) return;
        setDialogTaskId(target.task.id);
        setSelection({ key: target.key, index: items.indexOf(target) });
        rowElements.current.get(target.key)?.scrollIntoView?.({ block: 'nearest' });
    };
    const openIds = new Set(allTasks.filter(t => !t.is_done).map(t => t.id));

    /** "+ Add task" after the last row of an expanded project (Todoist). */
    const addRowAfter = (index: number) => {
        if (sortMode) return null;
        const next = items[index + 1];
        if (next && next.depth > 0) return null; // the project continues
        let start = index;
        while (start > 0 && items[start].depth > 0) start--;
        const root = items[start];
        if (root.kind !== 'task' || !root.hasChildren || !root.expanded || root.task.is_done) return null;
        const key = `add:${root.task.id}`;
        if (draft?.afterKey === key) return renderDraft();
        return (
            <AddTaskRow key={key} depth={1} label={`add task to ${root.task.header}`}
                onClick={() => setDraft({ parentId: root.task.id, depth: 1, afterKey: key, text: '' })} />
        );
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="h5" component="h1" sx={{ mr: 1 }}>{sortMode ? 'Sorting session' : 'Tasks'}</Typography>
                {!sortMode && (
                    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
                        New task
                    </Button>
                )}
                <Chip label={`Inbox (${inboxCount})`} size="small" variant={sortMode ? 'filled' : 'outlined'} />
                <Button size="small" variant={sortMode ? 'contained' : 'outlined'}
                    onClick={() => (sortMode ? (setSortMode(false), refocus()) : startSort())}>
                    {sortMode ? 'Done sorting' : 'Sort ▶'}
                </Button>
                {!rowButtons && (
                    <Tooltip title={sortMode
                        ? '↑/↓ select · E estimate · M move · # tag · 0–9 priority · S split · Space track · Del delete · Enter details'
                        : '↑/↓ select · Enter / click details (Alt+↑/↓ inside: previous/next) · Tab / Shift+Tab indent · Alt+↑/↓ move · E estimate · M move to · # tag · 0–9 priority · S split · Space track · Del delete'}>
                        <IconButton size="small" aria-label="keyboard shortcuts"><HelpOutlineIcon fontSize="small" /></IconButton>
                    </Tooltip>
                )}
                {!sortMode && (
                    <FormControlLabel sx={{ ml: 'auto' }}
                        control={<Switch size="small" checked={showCompleted} onChange={event => toggleShowCompleted(event.target.checked)} />}
                        label={<Typography variant="body2">Show completed</Typography>} />
                )}
            </Box>
            <Box
                ref={container}
                role="tree"
                aria-label="Outline"
                tabIndex={0}
                onKeyDown={onKeyDown}
                sx={{ outline: 'none', border: 1, borderColor: 'divider', borderRadius: 1, '&:focus-visible': { borderColor: 'primary.main' } }}
            >
                {items.length === 0 && (
                    <Typography sx={{ p: 2 }} color="text.secondary">
                        {sortMode ? 'The inbox is empty — every task has an estimate.' : 'No open tasks here yet. Use the quick add (N) above.'}
                    </Typography>
                )}
                {items.map((item, index) => [
                    <OutlineItemRow
                        key={item.key}
                        item={item}
                        selected={index === selectedIndex}
                        sortMode={sortMode}
                        defaultDuration={defaultDuration}
                        editing={editing?.key === item.key ? editing : null}
                        onSelect={() => { setSelection({ key: item.key, index }); refocus(); }}
                        onOpen={() => (item.kind === 'task' ? setDialogTaskId(item.task.id) : setSplitTask(item.task))}
                        onToggle={() => toggleCollapsed(item.task.id)}
                        onToggleDone={() => toggleDone(item.task)}
                        canComplete={item.task.is_done || !(item.task.children_ids ?? []).some(id => openIds.has(id))}
                        onTrack={() => startTracking.mutate(item.task.id, { onError: error => setMessage(serverMessage(error)) })}
                        onEditChange={text => editing && setEditing({ ...editing, text, error: undefined })}
                        onEditKeyDown={onEditKeyDown}
                        onEditBlur={() => { if (editing?.field === 'estimate') commitEdit(); }}
                        onElement={element => {
                            if (element) rowElements.current.set(item.key, element);
                            else rowElements.current.delete(item.key);
                        }}
                    />,
                    rowButtons && index === selectedIndex && !editing ? (
                        <RowTools
                            key={`${item.key}-tools`}
                            item={item}
                            sortMode={sortMode}
                            canOutdent={outdentParent(item.task, visibleTasks) !== undefined}
                            canIndent={indentParent(item.task, visibleTasks) !== null}
                            canMoveUp={reorderPatches(item.task, visibleTasks, -1).length > 0}
                            canMoveDown={reorderPatches(item.task, visibleTasks, 1).length > 0}
                            onOutdent={() => reparent(item.task, outdentParent(item.task, visibleTasks))}
                            onIndent={() => reparent(item.task, indentParent(item.task, visibleTasks) ?? undefined)}
                            onMove={direction => reorder(item.task, direction)}
                            onDetails={() => setDialogTaskId(item.task.id)}
                            onSplit={() => setSplitTask(item.task)}
                        />
                    ) : null,
                    draft?.afterKey === item.key ? renderDraft() : null,
                    addRowAfter(index),
                ])}
                {!sortMode && (draft?.afterKey === END_OF_TREE ? renderDraft() : (
                    <AddTaskRow key="add-top" depth={0} label="add task at the top level"
                        onClick={() => setDraft({ parentId: null, depth: 0, afterKey: END_OF_TREE, text: '' })} />
                ))}
            </Box>

            <ProjectPicker
                open={move !== null} anchorEl={move?.anchor ?? null}
                onClose={() => { setMove(null); refocus(); }} onPick={pickMove}
                projects={projectOptions(visibleTasks).filter(p => move && p.id !== move.task.id
                    && !visibleTasks.find(t => t.id === p.id)?.ancestor_ids?.includes(move.task.id))}
                noneLabel="Top level — make it a project of its own"
                placeholder={move ? `Move “${move.task.header}” to…` : undefined}
            />
            {splitTask && <SplitEditor open task={splitTask} onClose={() => { setSplitTask(null); refocus(); }} />}
            {dialogTask && (
                <TaskFormDialog open task={dialogTask}
                    canNavigate={{ previous: dialogPosition > 0, next: dialogPosition >= 0 && dialogPosition < taskItems.length - 1 }}
                    onNavigate={openNeighbour}
                    onClose={() => { setDialogTaskId(null); refocus(); }} />
            )}
            {creating && <TaskFormDialog open onClose={() => { setCreating(false); refocus(); }} />}
            <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
                <DialogTitle>Delete “{confirmDelete?.header}”?</DialogTitle>
                <DialogContent>
                    <Typography>It has {confirmDelete?.children_ids?.length} subtasks. What should happen to them?</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
                    <Button onClick={() => confirmDelete && deleteParent(confirmDelete, 'lift')}>Move them up one level</Button>
                    <Button color="error" onClick={() => confirmDelete && deleteParent(confirmDelete, 'delete')}>Delete everything</Button>
                </DialogActions>
            </Dialog>
            <Snackbar open={lastPending !== undefined} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="info" variant="filled"
                    action={<Button color="inherit" size="small" onClick={undoDelete}>Undo</Button>}>
                    Deleted “{lastPending?.[1]}”
                </Alert>
            </Snackbar>
            <Snackbar open={completedToast !== null} autoHideDuration={6000} onClose={() => setCompletedToast(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="success" variant="filled" onClose={() => setCompletedToast(null)}
                    action={<Button color="inherit" size="small" onClick={undoComplete}>Undo</Button>}>
                    {completedToast?.text}
                </Alert>
            </Snackbar>
            <Snackbar open={message !== null} autoHideDuration={6000} onClose={() => setMessage(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="error" variant="filled" onClose={() => setMessage(null)}>{message}</Alert>
            </Snackbar>
        </Box>
    );
}

interface OutlineItemRowProps {
    item: OutlineItem;
    selected: boolean;
    sortMode: boolean;
    defaultDuration: string;
    editing: Editing | null;
    onSelect: () => void;
    onOpen: () => void;
    onToggle: () => void;
    onToggleDone: () => void;
    /** False for parents with open subtasks (they complete with the last one). */
    canComplete: boolean;
    onTrack: () => void;
    onEditChange: (text: string) => void;
    onEditKeyDown: (event: React.KeyboardEvent) => void;
    onEditBlur: () => void;
    onElement: (element: HTMLElement | null) => void;
}

function OutlineItemRow({
    item, selected, sortMode, defaultDuration, editing, onSelect, onOpen, onToggle, onToggleDone, canComplete, onTrack,
    onEditChange, onEditKeyDown, onEditBlur, onElement,
}: OutlineItemRowProps) {
    const task = item.task;
    const done = item.kind === 'task' && task.is_done;
    const trackable = !done && (item.kind === 'rest' || !(task.children_ids?.length));
    const overdue = !done && task.latest_finish_date !== null && new Date(task.latest_finish_date) < new Date();

    const estimate = (() => {
        if (item.kind === 'rest') return <Typography variant="body2">{human(task.rest ?? null)}</Typography>;
        if (editing?.field === 'estimate') {
            return (
                <TextField size="small" autoFocus value={editing.text} error={Boolean(editing.error)}
                    onChange={event => onEditChange(event.target.value)}
                    onKeyDown={onEditKeyDown} onBlur={onEditBlur}
                    slotProps={{ htmlInput: { 'aria-label': `Edit estimate of ${task.header}`, inputMode: 'decimal' } }}
                    sx={{ width: 110 }} />
            );
        }
        if (task.parts_total) {
            return (
                <Typography data-testid="estimate" variant="body2" color={task.over_budget ? 'warning.main' : 'text.secondary'}>
                    Σ {human(task.parts_total)} / {human(task.duration ?? defaultDuration)}
                </Typography>
            );
        }
        return task.duration
            ? <Typography data-testid="estimate" variant="body2" color="text.secondary">{human(task.duration)}</Typography>
            : <Typography data-testid="estimate" variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {human(defaultDuration)} (default)
            </Typography>;
    })();

    return (
        <Box
            role="treeitem"
            aria-label={itemName(item)}
            aria-level={item.depth + 1}
            aria-selected={selected}
            aria-expanded={item.kind === 'task' && item.hasChildren ? item.expanded : undefined}
            data-active={item.kind === 'task' && item.active ? 'true' : undefined}
            data-done={done ? 'true' : undefined}
            ref={onElement}
            onClick={() => { onSelect(); onOpen(); }}
            sx={{
                display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, pr: 1,
                pl: 0.5 + item.depth * 3, borderBottom: 1, borderColor: 'divider', cursor: 'default',
                bgcolor: selected ? 'action.selected' : undefined,
                opacity: done ? 0.55 : 1,
                '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
            }}
        >
            <Box sx={{ width: 28, flexShrink: 0 }}>
                {item.kind === 'task' && item.hasChildren && (
                    <IconButton size="small" aria-label={item.expanded ? `collapse ${task.header}` : `expand ${task.header}`}
                        onClick={event => { event.stopPropagation(); onToggle(); }}>
                        {item.expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                    </IconButton>
                )}
            </Box>
            <Box sx={{ width: 28, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                {item.kind === 'task' && (
                    <Tooltip title={canComplete ? '' : 'Completes by itself with its last open subtask'}>
                        <span>
                            <Checkbox size="small" checked={done} disabled={!canComplete}
                                icon={<RadioButtonUncheckedIcon fontSize="small" />}
                                checkedIcon={<CheckCircleIcon fontSize="small" />}
                                slotProps={{ input: { 'aria-label': `${done ? 'reopen' : 'complete'} ${task.header}` } }}
                                onClick={event => event.stopPropagation()}
                                onChange={onToggleDone}
                                sx={{ p: 0.25 }} />
                        </span>
                    </Tooltip>
                )}
            </Box>
            {item.kind === 'task' && item.depth === 0 && !sortMode && (
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: task.hex_color ?? 'text.disabled', flexShrink: 0 }} />
            )}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
                {editing?.field === 'header' ? (
                    <TextField size="small" fullWidth autoFocus value={editing.text} error={Boolean(editing.error)}
                        helperText={editing.error}
                        onChange={event => onEditChange(event.target.value)}
                        onKeyDown={onEditKeyDown}
                        slotProps={{ htmlInput: { 'aria-label': `Edit header of ${task.header}` } }} />
                ) : (
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{
                            fontWeight: item.kind === 'task' && item.hasChildren ? 'bold' : undefined,
                            fontStyle: item.kind === 'rest' ? 'italic' : undefined,
                            color: item.kind === 'rest' ? 'text.secondary' : undefined,
                            textDecoration: done ? 'line-through' : undefined,
                        }}>
                            {itemName(item)}
                        </Typography>
                        {sortMode && item.kind === 'task' && item.path && (
                            <Typography variant="caption" color="text.secondary" noWrap component="div">{item.path}</Typography>
                        )}
                    </Box>
                )}
                {item.kind === 'task' && item.active && !editing && (
                    <Chip size="small" color="primary" variant="outlined" label="active"
                        sx={{ height: 18, fontSize: '0.7rem', flexShrink: 0 }} />
                )}
            </Box>
            {/* Aligned, muted details (Todoist/Wunderlist density). Tags and
                the deadline give way on phone widths. */}
            <Box sx={{ width: { xs: 'auto', sm: 130 }, textAlign: 'right', flexShrink: 0, color: 'text.secondary' }}>
                {estimate}
            </Box>
            <Box sx={{ width: 170, flexShrink: 0, display: { xs: 'none', sm: 'flex' }, justifyContent: 'flex-end', gap: 0.5, overflow: 'hidden' }}>
                {item.kind === 'task' && task.tags.map(tag => (
                    <Chip key={tag.id} size="small" variant="outlined" label={`#${tag.name}`} sx={{ height: 20 }} />
                ))}
            </Box>
            <Box sx={{ width: 64, flexShrink: 0, display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
                {item.kind === 'task' && task.latest_finish_date && (
                    <Typography data-testid="deadline" data-overdue={overdue ? 'true' : undefined} variant="caption"
                        color={overdue ? 'error.main' : 'text.secondary'} sx={{ fontWeight: overdue ? 'bold' : undefined }}>
                        ⏰ {new Date(task.latest_finish_date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}
                    </Typography>
                )}
            </Box>
            <Box sx={{ width: 28, flexShrink: 0, textAlign: 'right' }}>
                {item.kind === 'task' && (
                    <Typography variant="caption" color="text.secondary">!{task.priority}</Typography>
                )}
            </Box>
            <Box sx={{ width: 32, flexShrink: 0 }}>
                {trackable && (
                    <IconButton size="small" aria-label={`start tracking ${task.header}`}
                        onClick={event => { event.stopPropagation(); onTrack(); }}>
                        <PlayArrowIcon fontSize="small" />
                    </IconButton>
                )}
            </Box>
        </Box>
    );
}

/** Todoist's inline "+ Add task" at the end of a project / of the tree. */
function AddTaskRow({ depth, label, onClick }: { depth: number; label: string; onClick: () => void }) {
    return (
        <Box sx={{ pl: 0.5 + depth * 3 + 7, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
            <Button size="small" startIcon={<AddIcon fontSize="small" />} aria-label={label} onClick={onClick}
                sx={{ textTransform: 'none', color: 'text.secondary', '&:hover': { color: 'primary.main' } }}>
                Add task
            </Button>
        </Box>
    );
}

interface RowToolsProps {
    item: OutlineItem;
    sortMode: boolean;
    canOutdent: boolean;
    canIndent: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onOutdent: () => void;
    onIndent: () => void;
    onMove: (direction: -1 | 1) => void;
    onDetails: () => void;
    onSplit: () => void;
}

/** Touch: the keys of the selected row as buttons (UI-9). */
function RowTools({
    item, sortMode, canOutdent, canIndent, canMoveUp, canMoveDown, onOutdent, onIndent, onMove, onDetails, onSplit,
}: RowToolsProps) {
    const isTask = item.kind === 'task';
    return (
        <Box role="toolbar" aria-label={itemName(item)}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pl: 1 + item.depth * 3 + 4.5, pr: 1, py: 0.25, bgcolor: 'action.selected' }}>
            {isTask && !sortMode && (
                <>
                    <IconButton aria-label="outdent" disabled={!canOutdent} onClick={onOutdent}><FormatIndentDecreaseIcon fontSize="small" /></IconButton>
                    <IconButton aria-label="indent" disabled={!canIndent} onClick={onIndent}><FormatIndentIncreaseIcon fontSize="small" /></IconButton>
                    <IconButton aria-label="move up" disabled={!canMoveUp} onClick={() => onMove(-1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                    <IconButton aria-label="move down" disabled={!canMoveDown} onClick={() => onMove(1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                </>
            )}
            {isTask && <IconButton aria-label="details" onClick={onDetails}><EditIcon fontSize="small" /></IconButton>}
            <IconButton aria-label="split" onClick={onSplit}><CallSplitIcon fontSize="small" /></IconButton>
        </Box>
    );
}
