/**
 * UI-6: the split editor (docs/task-entry-ui.md §4).
 *
 * The parent's estimate is a budget. Parts without a typed duration show a
 * ghost share of what is not assigned yet, so the numbers add up without
 * typing any; the allocation bar shows spent time, parts, the rest or the
 * overflow. "Set estimate to Σ parts" (or "Raise estimate" when over) adopts
 * the parts as the new estimate. Saving sends the whole outline in one
 * request (``POST /tasks/{id}/split/``) — ghosts become real estimates.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControlLabel, TextField, Typography,
} from '@mui/material';
import type { AxiosError } from 'axios';

import { AllocationBar } from '../AllocationBar/AllocationBar.tsx';
import { OutlineRows } from '../OutlineRows/OutlineRows.tsx';
import { parseDurationInput } from '../TaskFormDialog/taskFormValidation.ts';
import { createTag } from '../../api.ts';
import { useSettings, useSplitTask, useTags, useTasks } from '../../queries.tsx';
import { minutesToText, newRow, type OutlineRow } from '../../utils/outline.ts';
import { allocation as computeAllocation, computeBudgets } from '../../utils/splitMath.ts';
import { rowsFromTasks, rowsToRequest } from '../../utils/splitPayload.ts';
import { formatDuration, minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import type { SplitRequest, Task } from '../../types.ts';

const human = (minutes: number) => formatDuration(minutesToDurationString(minutes));

type EstimateReason = NonNullable<SplitRequest['estimate_reason']>;

/** The first readable message in a DRF error payload (nested row errors too). */
function firstMessage(data: unknown): string | null {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
        for (const item of data) { const found = firstMessage(item); if (found) return found; }
    } else if (data && typeof data === 'object') {
        for (const value of Object.values(data)) { const found = firstMessage(value); if (found) return found; }
    }
    return null;
}

export interface SplitEditorProps {
    task: Task;
    open: boolean;
    onClose: () => void;
}

export function SplitEditor({ task, open, onClose }: SplitEditorProps) {
    const tasks = useTasks();
    const tags = useTags();
    const settings = useSettings();
    // The rows start from the task tree, so wait for it: starting from an
    // empty outline would remove the existing parts on save.
    const ready = tasks.isSuccess && tags.isSuccess && settings.isSuccess;
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            {ready ? (
                <SplitEditorForm key={task.id} task={task} tasks={tasks.data} tagList={tags.data}
                    defaultDuration={settings.data.default_duration} onClose={onClose} />
            ) : (
                <DialogContent sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                    <CircularProgress aria-label="loading" />
                </DialogContent>
            )}
        </Dialog>
    );
}

interface SplitEditorFormProps {
    task: Task;
    tasks: Task[];
    tagList: { id: string; name: string }[];
    defaultDuration: string;
    onClose: () => void;
}

function SplitEditorForm({ task, tasks, tagList, defaultDuration, onClose }: SplitEditorFormProps) {
    const split = useSplitTask();
    const defaultMinutes = parseDurationMinutes(defaultDuration) ?? 60;
    const initialEstimate = parseDurationMinutes(task.duration);
    const [rows, setRows] = useState<OutlineRow[]>(() => {
        const existing = rowsFromTasks(task, tasks);
        return existing.length > 0 ? existing : [newRow(0)];
    });
    const [estimateText, setEstimateText] = useState(() =>
        initialEstimate !== null ? minutesToText(initialEstimate) : '');
    const [estimateReason, setEstimateReason] = useState<EstimateReason | null>(null);
    const [sequential, setSequential] = useState(true);
    const [inheritTags, setInheritTags] = useState(true);
    const [inheritPriority, setInheritPriority] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const estimateParse = parseDurationInput(estimateText);
    const estimateInvalid = estimateParse.kind === 'invalid' || (estimateParse.kind === 'ok' && estimateParse.minutes <= 0);
    const estimate = estimateParse.kind === 'ok' && estimateParse.minutes > 0 ? estimateParse.minutes : defaultMinutes;
    const spent = parseDurationMinutes(task.time_spent) ?? 0;

    const budgets = useMemo(
        () => computeBudgets(rows, Math.max(0, estimate - spent), defaultMinutes),
        [rows, estimate, spent, defaultMinutes],
    );
    const bar = computeAllocation(estimate, spent, rows, budgets);
    const sumEstimate = bar.partsTotal + spent;
    const context = useMemo(() => ({ now: new Date(), tags: tagList, projects: [] }), [tagList]);
    const rowError = rows.some(r => r.error);
    const path = [...(task.ancestor_ids ?? []).map(id => tasks.find(t => t.id === id)?.header), task.header]
        .filter(Boolean).join(' › ');

    const adoptSum = (reason: EstimateReason) => {
        setEstimateText(minutesToText(sumEstimate));
        setEstimateReason(reason);
    };

    const save = async () => {
        setError(null);
        if (rows.some(r => r.id && !r.done && r.header.trim() === '')) {
            setError('Every existing part needs a name. Type one, or remove the part’s text and press Backspace.');
            return;
        }
        try {
            const newNames = [...new Set(rows.flatMap(r => r.newTags ?? []))];
            const created = await Promise.all(newNames.map(name => createTag({ name })));
            const newTagIds = new Map(created.map(tag => [tag.name, tag.id]));
            const body: SplitRequest = {
                children: rowsToRequest(rows, budgets, newTagIds),
                sequential, inherit_tags: inheritTags, inherit_priority: inheritPriority,
            };
            const typedEstimate = estimateParse.kind === 'ok' ? estimateParse.minutes : null;
            if (typedEstimate !== initialEstimate) {
                body.estimate = typedEstimate !== null ? minutesToDurationString(typedEstimate) : null;
                body.estimate_reason = estimateReason ?? 'split';
            }
            await split.mutateAsync({ taskId: task.id, body });
            onClose();
        } catch (caught) {
            const data = (caught as AxiosError)?.response?.data;
            setError(firstMessage(data) ?? 'Could not save the parts. Please try again.');
        }
    };

    const inheritedTags = task.tags.map(tag => `#${tag.name}`).join(' ');

    return (
        <>
            <DialogTitle sx={{ pb: 0.5 }}>
                Split “{task.header}”
                <Typography variant="body2" color="text.secondary">
                    {[path !== task.header ? path : null, inheritedTags || null,
                        task.effective_deadline ? `⏰ ${new Date(task.effective_deadline).toLocaleDateString()}` : null]
                        .filter(Boolean).join(' · ')}
                </Typography>
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '12px !important' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                        size="small" label="Estimate" value={estimateText}
                        onChange={event => { setEstimateText(event.target.value); setEstimateReason(null); }}
                        error={estimateInvalid}
                        helperText={estimateInvalid ? `“${estimateText}” is not a duration. Use e.g. 12h, 1.5 or 1:30.`
                            : estimateParse.kind === 'empty' ? `Empty = your default (${human(defaultMinutes)})` : ' '}
                        slotProps={{ htmlInput: { 'aria-label': 'Estimate', inputMode: 'decimal' } }}
                        sx={{ width: 180 }}
                    />
                    <Typography variant="body2" data-testid="split-summary">
                        Σ parts {human(bar.partsTotal)} · spent {human(spent)}
                        {bar.unassigned > 0 && ` · ${human(bar.unassigned)} not assigned yet`}
                    </Typography>
                    {bar.overBy > 0 && (
                        <Typography variant="body2" color="error">
                            {human(bar.overBy)} over the estimate —{' '}
                            <Button size="small" color="error" onClick={() => adoptSum('raised_from_warning')}>
                                Raise estimate to {human(sumEstimate)}
                            </Button>
                        </Typography>
                    )}
                </Box>
                <AllocationBar allocation={bar} />
                <OutlineRows rows={rows} budgets={budgets} onChange={setRows} context={context} />
                <Typography variant="caption" color="text.secondary">
                    Enter: new part · Tab / Shift+Tab: indent · Alt+↑/↓: move · “CAD 3h #tag” sets estimate and tags ·
                    paste a list to add many
                </Typography>
                <FormControlLabel
                    control={<Checkbox checked={sequential} onChange={event => setSequential(event.target.checked)} />}
                    label="Do these in this order (adds dependencies 1 → 2 → 3 …)"
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="text.secondary">Inherit from parent:</Typography>
                    <FormControlLabel
                        control={<Checkbox size="small" checked={inheritTags} onChange={event => setInheritTags(event.target.checked)} />}
                        label={`tags ${inheritedTags || '(none)'}`}
                    />
                    <FormControlLabel
                        control={<Checkbox size="small" checked={inheritPriority} onChange={event => setInheritPriority(event.target.checked)} />}
                        label={`priority ${task.priority}`}
                    />
                    <Typography variant="caption" color="text.secondary">(the deadline always applies)</Typography>
                </Box>
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
                <Button onClick={() => adoptSum('set_to_sum')} disabled={bar.partsTotal === 0}>
                    Set estimate to Σ parts ({human(sumEstimate)})
                </Button>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button variant="contained" onClick={save}
                        disabled={estimateInvalid || rowError || split.isPending}>
                        Save
                    </Button>
                </Box>
            </DialogActions>
        </>
    );
}
