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
 * T-6: drag a row by its ⠿ handle — up/down to reorder, sideways to change
 * the level (dnd-kit; long-press on touch); every move, also by keys, goes
 * through the move endpoint with an Undo toast.
 *
 * Touch screens (UI-9): the selected row gets buttons for what lives on keys
 * — outdent, indent, move, details (no double-click on a phone), split.
 *
 * "Draw dependency" (or AltGr): a line dragged from one task to another
 * makes the first depend on the second (Undo in the toast); a refusal says
 * why in a toast.
 *
 * The filter bar (README: Filtering tasks) narrows the tree to the tasks
 * that pass, with their parents greyed for context and every parent open;
 * reordering waits until the filter is cleared.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
    IconButton, Portal, Snackbar, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddLinkIcon from '@mui/icons-material/AddLink';
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
import RepeatIcon from '@mui/icons-material/Repeat';
import EventIcon from '@mui/icons-material/Event';
import type { AxiosError } from 'axios';
import {
    closestCenter, DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor, TouchSensor, useSensor, useSensors,
    type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

import { DependencyDrawLayer } from '../DependencyDrawLayer/DependencyDrawLayer.tsx';
import { ProjectPicker, type ProjectPick } from '../ProjectPicker/ProjectPicker.tsx';
import { SplitEditor } from '../SplitEditor/SplitEditor.tsx';
import { TaskFilterBar } from '../TaskFilterBar/TaskFilterBar.tsx';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';
import { parseDurationInput } from '../TaskFormDialog/taskFormValidation.ts';
import { createTag, deleteTask as deleteTaskRequest } from '../../api.ts';
import {
    useCompleteTask, useCreateDependency, useCreateTask, useDeleteDependency, useDeleteTask, useMoveTask, useReopenTask,
    useSetPriority, useSettings, useStartTracking, useTags, useTasks, useUpdateTask,
} from '../../queries.tsx';
import { useDependencyDrawing } from '../../hooks/useDependencyDrawing.ts';
import { useTaskFilter } from '../../hooks/useTaskFilter.ts';
import { EMPTY_FILTER, filterTasks, isFiltering } from '../../utils/taskFilter.ts';
import { dependencyCreated, dependencyRefusal } from '../../utils/dependencyMessages.ts';
import { PrioritySlider } from '../PrioritySlider/PrioritySlider.tsx';
import { titleColor } from '../../utils/taskColors.ts';
import { commitRowTokens, newRow } from '../../utils/outline.ts';
import {
    inboxItems, outlineItems, type OutlineItem,
} from '../../utils/outlineTree.ts';
import {
    appendTarget, currentPosition, indentMove, neighbourMove, outdentMove, projectDrop, type MoveTarget,
} from '../../utils/treeDnd.ts';
import { projectOptions } from '../../utils/projects.ts';
import { readCollapsed, readShowCompleted, storeCollapsed, storeShowCompleted } from '../../utils/taskTreePrefs.ts';
import { formatDuration, minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import { dueFrom, recurrenceSummary, withoutLaterOccurrences } from '../../utils/recurring.ts';
import type { DependencyCycleError, Task, TaskWrite } from '../../types.ts';
import { useIsMobile, useIsNarrow, useIsTouch } from '../../hooks/useResponsive.ts';

const human = (duration: string | null) => formatDuration(duration);
const END_OF_TREE = 'add:top';
/** One indentation level in px (rows indent by theme spacing 3). */
const INDENT_PX = 24;
/** Hovering a collapsed parent this long while dragging opens it. */
const EXPAND_ON_HOVER_MS = 700;
const REORDER_HINT = 'Clear the filter to reorder.';
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
    const setPriorityMutation = useSetPriority();
    const moveMutation = useMoveTask();
    const createDependency = useCreateDependency();
    const deleteDependency = useDeleteDependency();

    const [sortMode, setSortMode] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
    const [showCompleted, setShowCompleted] = useState(readShowCompleted);
    // One Undo toast for completions and moves (Todoist).
    const [undoToast, setUndoToast] = useState<{ text: string; undo: () => void } | null>(null);
    // The active project whose path was last opened (see below).
    const [openedFor, setOpenedFor] = useState<string | null>(null);
    // T-6: the running drag — the row, the row under the pointer, the
    // sideways offset that decides the new depth.
    const [drag, setDrag] = useState<{ activeKey: string; overKey: string; offsetX: number } | null>(null);
    const expandTimer = useRef<{ key: string; timer: number } | null>(null);
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
    const [hint, setHint] = useState<string | null>(null);
    const [filter, setFilter] = useTaskFilter();
    const filtering = isFiltering(filter);

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
    // A recurring appointment's occurrences ahead: only the next one.
    const visibleTasks = useMemo(() => withoutLaterOccurrences(allTasks, new Date())
        .filter(t => !pendingDeletes.has(t.id)), [allTasks, pendingDeletes]);
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

    const defaultDuration = settings.data?.default_duration ?? '01:00:00';
    const defaultMinutes = parseDurationMinutes(defaultDuration) ?? 60;
    // The tasks the filter chooses from: those the tree would show (open
    // ones keep open parents, so the greyed context is always complete).
    const candidates = useMemo(() => (sortMode ? inboxItems(visibleTasks).map(i => i.task)
        : showCompleted ? visibleTasks : visibleTasks.filter(t => !t.is_done)),
    [sortMode, visibleTasks, showCompleted]);
    const filtered = useMemo(() => (filtering
        ? filterTasks(candidates, filter, { activeId, defaultMinutes }) : null),
    [filtering, candidates, filter, activeId, defaultMinutes]);
    const items = useMemo(() => {
        if (sortMode) {
            const inbox = inboxItems(visibleTasks);
            return filtered ? inbox.filter(i => filtered.matching.has(i.task.id)) : inbox;
        }
        if (!filtered) return outlineItems(visibleTasks, { activeId, collapsed, showCompleted });
        // Filtered: every parent of a match open, whatever was collapsed.
        const kept = candidates.filter(t => filtered.matching.has(t.id) || filtered.context.has(t.id));
        return outlineItems(kept, { activeId, collapsed: new Set(), showCompleted, context: filtered.context });
    }, [sortMode, visibleTasks, candidates, filtered, activeId, collapsed, showCompleted]);
    const inboxCount = useMemo(() => inboxItems(visibleTasks).length, [visibleTasks]);
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
    const narrow = useIsNarrow();
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

    /** Slider and digit keys (T-5): optimistic, one request per change. */
    const setPriority = (task: Task, priority: number) =>
        setPriorityMutation.mutateAsync({ taskId: task.id, priority })
            .catch(error => setMessage(serverMessage(error)));

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
                setUndoToast({
                    text: `Completed “${task.header}”${topmost ? ` — “${topmost.header}” completed too` : ''}`,
                    // Reopening the task reopens the parents that completed along (UI-2).
                    undo: () => reopenTask.mutate(task.id, { onError: error => setMessage(serverMessage(error)) }),
                });
            },
            onError: error => setMessage(serverMessage(error)),
        });
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

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        // Touch: long-press the handle, so scrolling still works.
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const clearExpandTimer = () => {
        if (expandTimer.current) window.clearTimeout(expandTimer.current.timer);
        expandTimer.current = null;
    };
    const onDragStart = ({ active }: DragStartEvent) =>
        setDrag({ activeKey: String(active.id), overKey: String(active.id), offsetX: 0 });
    const onDragMove = ({ delta }: DragMoveEvent) =>
        setDrag(current => (current && current.offsetX !== delta.x ? { ...current, offsetX: delta.x } : current));
    const onDragOver = ({ over }: DragOverEvent) => {
        if (!over) return;
        const overKey = String(over.id);
        setDrag(current => (current ? { ...current, overKey } : current));
        // A collapsed parent under the pointer opens after a moment (Todoist).
        const target = items.find(i => i.key === overKey);
        if (expandTimer.current?.key === overKey) return;
        clearExpandTimer();
        if (target?.kind === 'task' && target.hasChildren && !target.expanded) {
            expandTimer.current = {
                key: overKey,
                timer: window.setTimeout(() => updateCollapsed(next => { next.delete(target.task.id); }), EXPAND_ON_HOVER_MS),
            };
        }
    };
    const onDragEnd = ({ active, over, delta }: DragEndEvent) => {
        clearExpandTimer();
        setDrag(null);
        if (!over) return;
        const projection = projectDrop(items, allTasks, String(active.id), String(over.id), delta.x, INDENT_PX);
        const task = allTasks.find(t => t.id === active.id);
        if (projection?.changed && task) moveTo(task, { parentId: projection.parentId, index: projection.index });
    };
    const onDragCancel = () => { clearExpandTimer(); setDrag(null); };

    /** Every move (drag and drop, Tab, Alt+↑/↓, M, row buttons) goes through
     *  the move endpoint — optimistic, with Undo in the toast (T-6). */
    const moveTo = (task: Task, target: MoveTarget | null) => {
        if (!target) return;
        const from = currentPosition(allTasks, task.id);
        if (from && from.parentId === target.parentId && from.index === target.index) return;
        if (target.parentId) updateCollapsed(next => { next.delete(target.parentId!); }); // keep it in view
        moveMutation.mutateAsync({ taskId: task.id, ...target }).then(() => {
            if (!from) return;
            const parent = allTasks.find(t => t.id === target.parentId);
            const where = target.parentId === from.parentId ? ''
                : parent ? ` into “${parent.header}”` : ' to the top level';
            setUndoToast({
                text: `Moved “${task.header}”${where}`,
                // Straight back (not through moveTo: its task list predates the move).
                undo: () => moveMutation.mutate({ taskId: task.id, ...from },
                    { onError: error => setMessage(serverMessage(error)) }),
            });
        }).catch(error => setMessage(serverMessage(error)));
    };

    /** A line drawn from one row to another: the start task depends on the
     *  end task (a Rest row stands for its parent). */
    const linkTasks = (fromKey: string, toKey: string) => {
        const from = items.find(i => i.key === fromKey)?.task;
        const to = items.find(i => i.key === toKey)?.task;
        if (!from || !to) return;
        createDependency.mutateAsync({ predecessor: to.id, successor: from.id }).then(created => setUndoToast({
            text: dependencyCreated(from, to),
            undo: () => deleteDependency.mutate(created.id, { onError: error => setMessage(serverMessage(error)) }),
        })).catch(error => setMessage(dependencyRefusal(
            (error as AxiosError<DependencyCycleError>).response?.data, from, to,
            id => allTasks.find(t => t.id === id)?.header,
        )));
    };
    const drawing = useDependencyDrawing(linkTasks);
    const drawLine = drawing.line;
    const drawFrom = drawLine ? items.find(i => i.key === drawLine.fromKey) : undefined;
    const drawTo = drawLine && drawLine.overKey !== drawLine.fromKey
        ? items.find(i => i.key === drawLine.overKey) : undefined;

    /** The split editor — a recurring task says why it has no parts. */
    const openSplit = (task: Task) => {
        if (task.series_id) {
            setMessage(`“${task.header}” repeats: a recurring task cannot have subtasks.`);
            return;
        }
        setSplitTask(task);
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
        if (pick.kind === 'project') moveTo(move.task, appendTarget(allTasks, move.task.id, pick.id));
        else if (pick.kind === 'none') moveTo(move.task, appendTarget(allTasks, move.task.id, null));
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
            openSplit(task);
        } else if (!isTask) {
            return;
        } else if (key === 'ArrowRight' && selected.kind === 'task' && selected.hasChildren) {
            event.preventDefault();
            if (!filtering) updateCollapsed(next => { next.delete(task.id); }); // filtered: all open
        } else if (key === 'ArrowLeft' && selected.kind === 'task') {
            event.preventDefault();
            if (selected.hasChildren && selected.expanded && !filtering) updateCollapsed(next => { next.add(task.id); });
            else if (task.parent_id) select(items.findIndex(i => i.key === task.parent_id));
        } else if ((key === 'Tab' || (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown'))) && filtering && !sortMode) {
            event.preventDefault();
            setHint(REORDER_HINT);
        } else if (key === 'Tab' && !sortMode) {
            event.preventDefault();
            moveTo(task, event.shiftKey ? outdentMove(allTasks, task.id) : indentMove(allTasks, task.id));
        } else if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown') && !sortMode) {
            event.preventDefault();
            moveTo(task, neighbourMove(allTasks, task.id, key === 'ArrowUp' ? -1 : 1));
        } else if (/^[0-9]$/.test(key)) {
            event.preventDefault();
            setPriority(task, Number(key));
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
        <Box key="draft" sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 + draft.depth * 3 + 7.5, pr: 1, py: 0.5 }}>
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

    // While dragging, the dragged row's subtree is hidden (it travels along)
    // and the row shows the depth it would land at.
    const draggedSubtree = new Set<string>();
    if (drag) {
        const start = items.findIndex(i => i.key === drag.activeKey);
        for (let i = start + 1; start >= 0 && i < items.length && items[i].depth > items[start].depth; i++) {
            draggedSubtree.add(items[i].key);
        }
    }
    const projection = drag ? projectDrop(items, allTasks, drag.activeKey, drag.overKey, drag.offsetX, INDENT_PX) : null;
    const sortableKeys = sortMode || drawing.active || filtering ? [] : items
        .filter(i => i.kind === 'task' && !i.task.is_done && !draggedSubtree.has(i.key))
        .map(i => i.key);

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
        if (sortMode || filtering) return null; // a new task might not pass
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

    const showCompletedSwitch = (
        <FormControlLabel sx={{ ml: mobile ? 0 : 'auto' }}
            control={<Switch size="small" checked={showCompleted} onChange={event => toggleShowCompleted(event.target.checked)} />}
            label={<Typography variant="body2">Show completed</Typography>} />
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="h5" component="h1" sx={{ mr: 1 }}>{sortMode ? 'Sorting session' : 'Tasks'}</Typography>
                {!sortMode && (
                    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
                        New task
                    </Button>
                )}
                <Tooltip describeChild title={rowButtons ? 'Drag from a task to the task it depends on'
                    : 'Drag from a task to the task it depends on · AltGr (right Option on a Mac): tap to turn on/off, hold to draw while held · Esc stops'}>
                    <Button size="small" variant={drawing.active ? 'contained' : 'outlined'} aria-pressed={drawing.active}
                        startIcon={<AddLinkIcon />} onClick={drawing.toggle}>
                        Draw dependency
                    </Button>
                </Tooltip>
                <Chip label={`Inbox (${inboxCount})`} size="small" variant={sortMode ? 'filled' : 'outlined'} />
                <Button size="small" variant={sortMode ? 'contained' : 'outlined'}
                    onClick={() => (sortMode ? (setSortMode(false), refocus()) : startSort())}>
                    {sortMode ? 'Done sorting' : 'Sort ▶'}
                </Button>
                {!rowButtons && (
                    <Tooltip title={sortMode
                        ? '↑/↓ select · E estimate · M move · # tag · 0–9 priority · S split · Space track · Del delete · Enter details'
                        : '⠿ drag to move (sideways: indent) · ↑/↓ select · Enter / click details (Alt+↑/↓ inside: previous/next) · Tab / Shift+Tab indent · Alt+↑/↓ move · E estimate · M move to · # tag · 0–9 priority · S split · Space track · Del delete'}>
                        <IconButton size="small" aria-label="keyboard shortcuts"><HelpOutlineIcon fontSize="small" /></IconButton>
                    </Tooltip>
                )}
                {!sortMode && !mobile && showCompletedSwitch}
            </Box>
            <TaskFilterBar filter={filter} onChange={setFilter}
                projects={projectOptions(visibleTasks)} tags={tags.data ?? []}
                matchCount={filtered ? filtered.matching.size : candidates.length} totalCount={candidates.length}
                sheetExtras={!sortMode && mobile ? showCompletedSwitch : undefined} />
            {drawing.active && (
                <Alert severity="info" role="status" sx={{ py: 0 }}>
                    Drag from a task to the task it depends on.{rowButtons
                        ? ' Tap “Draw dependency” again to stop.' : ' AltGr or Esc stops.'}
                </Alert>
            )}
            <Box
                ref={container}
                role="tree"
                aria-label="Outline"
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={drawing.onPointerDown}
                sx={{ outline: 'none', border: 1, borderColor: 'divider', borderRadius: 1, '&:focus-visible': { borderColor: 'primary.main' } }}
            >
                {items.length === 0 && filtering && (
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography color="text.secondary">No tasks match the filter.</Typography>
                        <Button size="small" onClick={() => setFilter(EMPTY_FILTER)}>Clear filter</Button>
                    </Box>
                )}
                {items.length === 0 && !filtering && (
                    <Typography sx={{ p: 2 }} color="text.secondary">
                        {sortMode ? 'The inbox is empty — every task has an estimate.' : 'No open tasks here yet. Use the quick add (N) above.'}
                    </Typography>
                )}
                <DndContext sensors={sensors} collisionDetection={closestCenter}
                    // The dragged subtree collapses: measure the rows again.
                    measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                    onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragOver}
                    onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
                <SortableContext items={sortableKeys} strategy={verticalListSortingStrategy}>
                {items.map((item, index) => draggedSubtree.has(item.key) ? null : [
                    <SortableRow
                        key={item.key}
                        sortable={sortableKeys.includes(item.key)}
                        dragDepth={drag?.activeKey === item.key ? projection?.depth : undefined}
                        handleVisible={rowButtons}
                        item={item}
                        selected={index === selectedIndex}
                        sortMode={sortMode}
                        defaultDuration={defaultDuration}
                        editing={editing?.key === item.key ? editing : null}
                        drawMode={drawing.active}
                        drawRole={drawFrom === item ? 'from' : drawTo === item ? 'to' : undefined}
                        onSelect={() => { setSelection({ key: item.key, index }); refocus(); }}
                        onOpen={() => {
                            if (drawing.active) return; // drawing: a click opens nothing
                            if (item.kind === 'task') setDialogTaskId(item.task.id); else setSplitTask(item.task);
                        }}
                        onToggle={() => toggleCollapsed(item.task.id)}
                        onToggleDone={() => toggleDone(item.task)}
                        onPriority={priority => setPriority(item.task, priority)}
                        compact={mobile}
                        narrow={narrow}
                        filtered={filtering}
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
                            canReorder={!filtering}
                            canOutdent={outdentMove(allTasks, item.task.id) !== null}
                            canIndent={indentMove(allTasks, item.task.id) !== null}
                            canMoveUp={neighbourMove(allTasks, item.task.id, -1) !== null}
                            canMoveDown={neighbourMove(allTasks, item.task.id, 1) !== null}
                            onOutdent={() => moveTo(item.task, outdentMove(allTasks, item.task.id))}
                            onIndent={() => moveTo(item.task, indentMove(allTasks, item.task.id))}
                            onMove={direction => moveTo(item.task, neighbourMove(allTasks, item.task.id, direction))}
                            onDetails={() => setDialogTaskId(item.task.id)}
                            onSplit={() => openSplit(item.task)}
                        />
                    ) : null,
                    draft?.afterKey === item.key ? renderDraft() : null,
                    // Kept while dragging: removing rows above the dragged one
                    // would shift it away from the pointer.
                    addRowAfter(index),
                ])}
                </SortableContext>
                </DndContext>
                {!sortMode && !filtering && (draft?.afterKey === END_OF_TREE ? renderDraft() : (
                    <AddTaskRow key="add-top" depth={0} label="add task at the top level"
                        onClick={() => setDraft({ parentId: null, depth: 0, afterKey: END_OF_TREE, text: '' })} />
                ))}
            </Box>

            {drawLine && drawFrom && (
                <Portal>
                    <DependencyDrawLayer from={drawLine.from} to={drawLine.to} onTarget={drawTo !== undefined}
                        label={drawTo ? `“${drawFrom.task.header}” depends on “${drawTo.task.header}”`
                            : `Drop on the task “${drawFrom.task.header}” depends on`} />
                </Portal>
            )}
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
            <Snackbar open={undoToast !== null} autoHideDuration={6000} onClose={() => setUndoToast(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="success" variant="filled" onClose={() => setUndoToast(null)}
                    action={<Button color="inherit" size="small"
                        onClick={() => { undoToast?.undo(); setUndoToast(null); }}>Undo</Button>}>
                    {undoToast?.text}
                </Alert>
            </Snackbar>
            <Snackbar open={hint !== null} autoHideDuration={4000} onClose={() => setHint(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="info" variant="filled" onClose={() => setHint(null)}>{hint}</Alert>
            </Snackbar>
            <Snackbar open={message !== null} autoHideDuration={6000} onClose={() => setMessage(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="error" variant="filled" onClose={() => setMessage(null)}>{message}</Alert>
            </Snackbar>
        </Box>
    );
}

/** What a sortable row gets from dnd-kit (T-6). */
interface RowDrag {
    enabled: boolean;
    /** Callback refs (named so the compiler lint does not take ``drag`` for a ref). */
    attachRow: (element: HTMLElement | null) => void;
    attachHandle: (element: HTMLElement | null) => void;
    handleProps: Record<string, unknown>;
    style: React.CSSProperties;
    dragging: boolean;
    /** The depth this row would land at, while it is dragged. */
    depth?: number;
    /** Touch screens: the handle is always visible (no hover). */
    handleVisible: boolean;
}

/** The ⠿ handle: the only place a row can be grabbed (clicks elsewhere open
 *  the dialog, the slider stays usable; long-press on touch). */
function DragHandle({ label, attach, handleProps, dragging }: {
    label: string; attach: (element: HTMLElement | null) => void;
    handleProps: Record<string, unknown>; dragging: boolean;
}) {
    return (
        <IconButton size="small" className="drag-handle" aria-label={label} ref={attach} {...handleProps}
            onClick={event => event.stopPropagation()}
            sx={{ p: 0.25, cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', color: 'text.secondary' }}>
            <DragIndicatorIcon fontSize="small" />
        </IconButton>
    );
}

/** A row taking part in drag and drop: dragged by its ⠿ handle only. */
function SortableRow({ sortable, dragDepth, handleVisible, ...props }: Omit<OutlineItemRowProps, 'drag'> & {
    sortable: boolean; dragDepth?: number; handleVisible: boolean;
}) {
    const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
        useSortable({ id: props.item.key, disabled: !sortable });
    return (
        <OutlineItemRow {...props} drag={{
            enabled: sortable, attachRow: setNodeRef, attachHandle: setActivatorNodeRef,
            handleProps: { ...attributes, ...listeners },
            style: { transform: CSS.Translate.toString(transform), transition },
            dragging: isDragging, depth: dragDepth, handleVisible,
        }} />
    );
}

interface OutlineItemRowProps {
    drag?: RowDrag;
    /** "Draw dependency" is on: rows start and end lines, not drags. */
    drawMode?: boolean;
    /** The row a line starts at or would end at. */
    drawRole?: 'from' | 'to';
    item: OutlineItem;
    selected: boolean;
    sortMode: boolean;
    defaultDuration: string;
    editing: Editing | null;
    onSelect: () => void;
    onOpen: () => void;
    onToggle: () => void;
    onToggleDone: () => void;
    onPriority: (priority: number) => void;
    /** Phones: a chip opening the slider instead of the slider itself, tighter
     *  gaps, and the active project marked by its name (no label). */
    compact: boolean;
    /** Below 900 px (phones too): the title gets the room — colored in the
     *  task's color instead of a dot, no tags, the estimate only as wide as
     *  it is, the active project marked by its name. */
    narrow: boolean;
    /** The filter is on: every parent open (no expand/collapse toggle). */
    filtered?: boolean;
    /** False for parents with open subtasks (they complete with the last one). */
    canComplete: boolean;
    onTrack: () => void;
    onEditChange: (text: string) => void;
    onEditKeyDown: (event: React.KeyboardEvent) => void;
    onEditBlur: () => void;
    onElement: (element: HTMLElement | null) => void;
}

function OutlineItemRow({
    item, selected, sortMode, defaultDuration, editing, onSelect, onOpen, onToggle, onToggleDone, onPriority, compact,
    narrow, filtered, canComplete, onTrack,
    onEditChange, onEditKeyDown, onEditBlur, onElement, drag, drawMode, drawRole,
}: OutlineItemRowProps) {
    const task = item.task;
    const depth = drag?.depth ?? item.depth;
    const done = item.kind === 'task' && task.is_done;
    const trackable = !done && (item.kind === 'rest' || !(task.children_ids?.length));
    const overdue = !done && task.latest_finish_date !== null && new Date(task.latest_finish_date) < new Date();
    // Narrow screens: the title shows the task's color (§4.4) instead of a dot.
    const tint = narrow ? titleColor(task.hex_color) : undefined;
    const activeName = narrow && item.kind === 'task' && item.active;
    // Filtered: a parent shown only for the subtasks that pass.
    const context = item.kind === 'task' && item.context;

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
            data-context={context ? 'true' : undefined}
            ref={(element: HTMLElement | null) => { onElement(element); drag?.attachRow(element); }}
            onClick={() => { onSelect(); onOpen(); }}
            style={drag?.style}
            data-dragging={drag?.dragging ? 'true' : undefined}
            data-row-key={item.key}
            data-draw={drawRole}
            sx={{
                display: 'flex', alignItems: 'center', gap: compact ? 0.5 : 1, minHeight: 32, pr: compact ? 0.5 : 1,
                pl: 0.5 + depth * 3, borderBottom: 1, borderColor: 'divider', cursor: 'default',
                bgcolor: drag?.dragging ? 'background.paper' : selected ? 'action.selected' : undefined,
                opacity: context ? 0.5 : done ? 0.55 : 1,
                position: 'relative', zIndex: drag?.dragging ? 2 : undefined,
                boxShadow: drag?.dragging ? 6 : undefined,
                outline: drag?.dragging ? '2px dashed' : drawRole ? '2px solid' : undefined, outlineColor: 'primary.main',
                outlineOffset: drawRole ? -2 : undefined,
                ...(drawMode ? { cursor: 'crosshair', userSelect: 'none', touchAction: 'none' } : {}),
                transitionProperty: 'padding-left', transitionDuration: '120ms',
                '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                // The handle fades in on hover / selection (Todoist).
                '& .drag-handle': { opacity: drag?.handleVisible || selected || drag?.dragging ? 1 : 0, transition: 'opacity 120ms' },
                '&:hover .drag-handle, & .drag-handle:focus-visible': { opacity: 1 },
            }}
        >
            <Box sx={{ width: 24, flexShrink: 0, ml: -0.5 }}>
                {drag?.enabled && (
                    <DragHandle label={`drag ${task.header}`} attach={drag.attachHandle}
                        handleProps={drag.handleProps} dragging={drag.dragging} />
                )}
            </Box>
            <Box sx={{ width: 28, flexShrink: 0 }}>
                {item.kind === 'task' && item.hasChildren && !filtered && (
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
            {/* The color the task shows (§4.4); a Rest shows its parent's. */}
            {!narrow && (
                <Box data-testid="task-color-dot" aria-hidden
                    style={task.hex_color ? { backgroundColor: task.hex_color } : undefined}
                    sx={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: 'text.disabled',
                        opacity: item.kind === 'rest' ? 0.6 : 1,
                    }} />
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
                        <Typography variant="body2" noWrap
                            data-active-name={activeName ? 'true' : undefined}
                            style={tint ? { color: tint } : undefined}
                            sx={{
                            fontWeight: item.kind === 'task' && (item.hasChildren || activeName) ? 'bold' : undefined,
                            fontStyle: item.kind === 'rest' ? 'italic' : undefined,
                            color: item.kind === 'rest' ? 'text.secondary' : undefined,
                            opacity: tint && item.kind === 'rest' ? 0.75 : undefined,
                            textDecoration: done ? 'line-through' : activeName ? 'underline' : undefined,
                            textUnderlineOffset: 3,
                        }}>
                            {itemName(item)}
                        </Typography>
                        {sortMode && item.kind === 'task' && item.path && (
                            <Typography variant="caption" color="text.secondary" noWrap component="div">{item.path}</Typography>
                        )}
                    </Box>
                )}
                {item.kind === 'task' && item.active && !editing && !narrow && (
                    <Chip size="small" color="primary" variant="outlined" label="active"
                        sx={{ height: 18, fontSize: '0.7rem', flexShrink: 0 }} />
                )}
                {item.kind === 'task' && task.series_id && !editing && (
                    <Tooltip title={recurrenceSummary(task)}>
                        <Box component="span" data-testid="repeats" aria-label={`repeats ${recurrenceSummary(task)}`}
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', flexShrink: 0 }}>
                            <RepeatIcon sx={{ fontSize: 16 }} />
                            {dueFrom(task, new Date()) && (
                                <Typography variant="caption" noWrap>{dueFrom(task, new Date())}</Typography>
                            )}
                        </Box>
                    </Tooltip>
                )}
                {item.kind === 'task' && task.calendar && !editing && (
                    <Tooltip title={`From ${task.calendar.name}${task.calendar.pending.length ? ': changed there' : ''}`}>
                        <Box component="span" data-testid="from-calendar" aria-label={`from ${task.calendar.name}`}
                            sx={{ display: 'inline-flex', flexShrink: 0 }}>
                            <EventIcon color={task.calendar.pending.length ? 'warning' : 'action'} sx={{ fontSize: 16 }} />
                        </Box>
                    </Tooltip>
                )}
            </Box>
            {/* Aligned, muted details (Todoist/Wunderlist density). Below 900 px
                the title comes first: the tags give way and the estimate
                column hugs its content (on phones the deadline goes too). */}
            <Box sx={{
                width: narrow ? 'auto' : 130, textAlign: 'right', flexShrink: 0, color: 'text.secondary',
                ...(compact ? { '& .MuiTypography-root': { fontSize: '0.75rem' } } : {}),
            }}>
                {estimate}
            </Box>
            {!narrow && (
                <Box sx={{ width: 170, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 0.5, overflow: 'hidden' }}>
                    {item.kind === 'task' && task.tags.map(tag => (
                        <Chip key={tag.id} size="small" variant="outlined" label={`#${tag.name}`} sx={{ height: 20 }} />
                    ))}
                </Box>
            )}
            <Box sx={{ width: 64, flexShrink: 0, display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
                {item.kind === 'task' && task.latest_finish_date && (
                    <Typography data-testid="deadline" data-overdue={overdue ? 'true' : undefined} variant="caption"
                        color={overdue ? 'error.main' : 'text.secondary'} sx={{ fontWeight: overdue ? 'bold' : undefined }}>
                        ⏰ {new Date(task.latest_finish_date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}
                    </Typography>
                )}
            </Box>
            <Box sx={{ width: compact ? 36 : 104, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                {item.kind === 'task' && !done && (
                    <PrioritySlider value={task.priority} label={task.header} onCommit={onPriority} compact={compact} />
                )}
                {done && <Typography variant="caption" color="text.secondary">!{task.priority}</Typography>}
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
        <Box sx={{ pl: 0.5 + depth * 3 + 10, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
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
    /** False while filtered: moving waits until the filter is cleared. */
    canReorder: boolean;
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
    item, sortMode, canReorder, canOutdent, canIndent, canMoveUp, canMoveDown, onOutdent, onIndent, onMove, onDetails, onSplit,
}: RowToolsProps) {
    const isTask = item.kind === 'task';
    return (
        <Box role="toolbar" aria-label={itemName(item)}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pl: 1 + item.depth * 3 + 4.5, pr: 1, py: 0.25, bgcolor: 'action.selected' }}>
            {isTask && !sortMode && !canReorder && (
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 1 }}>{REORDER_HINT}</Typography>
            )}
            {isTask && !sortMode && canReorder && (
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
