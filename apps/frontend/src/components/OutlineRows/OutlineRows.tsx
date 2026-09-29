/**
 * UI-6: editable outline rows (split editor now, outline view in UI-7),
 * keyboard-first like an outliner (docs/task-entry-ui.md §4.2):
 *
 * Enter new row · Tab / Shift+Tab indent / outdent · Backspace in an empty
 * row removes it · Alt+↑/↓ move · ↑/↓ focus · "CAD 3h #maker" moves the
 * tokens into the row · pasting several lines creates (nested) rows.
 */
import { useEffect, useRef } from 'react';
import { Box, Chip, InputBase, Typography } from '@mui/material';

import {
    commitRowTokens, indent, insertAfter, minutesToText, move, outdent, removeAt, rowsFromText,
    type OutlineRow,
} from '../../utils/outline.ts';
import type { RowBudget } from '../../utils/splitMath.ts';
import type { QuickAddContext } from '../../utils/quickAdd.ts';
import { parseDurationInput } from '../TaskFormDialog/taskFormValidation.ts';
import { formatDuration, minutesToDurationString } from '../../utils/duration.ts';

const human = (minutes: number) => formatDuration(minutesToDurationString(minutes));

export interface OutlineRowsProps {
    rows: OutlineRow[];
    budgets: Map<string, RowBudget>;
    onChange: (rows: OutlineRow[]) => void;
    /** For tokens typed into a row (tags, deadlines …); also names tag chips. */
    context: QuickAddContext;
}

export function OutlineRows({ rows, budgets, onChange, context }: OutlineRowsProps) {
    const tagNames = new Map(context.tags.map(tag => [tag.id, tag.name]));
    const inputs = useRef(new Map<string, HTMLInputElement>());
    // Focus requests are applied after the render that shows the new rows.
    const pendingFocus = useRef<string | null>(null);
    useEffect(() => {
        const key = pendingFocus.current;
        if (!key) return;
        pendingFocus.current = null;
        const input = inputs.current.get(key);
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
    });

    const update = (next: OutlineRow[], focusKey?: string) => {
        if (focusKey) pendingFocus.current = focusKey;
        onChange(next);
    };
    const replace = (index: number, row: OutlineRow) => rows.map((r, i) => (i === index ? row : r));
    /** Current rows with the tokens of row ``index`` committed. */
    const committed = (index: number) => {
        const row = commitRowTokens(rows[index], context);
        return row === rows[index] ? rows : replace(index, row);
    };

    const onHeaderKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
        const row = rows[index];
        if (event.key === 'Enter') {
            event.preventDefault();
            const next = insertAfter(committed(index), index);
            update(next.rows, next.rows[next.index].key);
        } else if (event.key === 'Tab') {
            event.preventDefault();
            update((event.shiftKey ? outdent : indent)(committed(index), index), row.key);
        } else if (event.key === 'Backspace' && row.header === '' && !row.id && rows.length > 1) {
            const next = removeAt(rows, index);
            if (next === rows) return;
            event.preventDefault();
            update(next, rows[Math.max(0, index - 1)].key);
        } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            const next = move(committed(index), index, event.key === 'ArrowUp' ? -1 : 1);
            update(next.rows, row.key);
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            const target = rows[index + (event.key === 'ArrowUp' ? -1 : 1)];
            if (!target) return;
            event.preventDefault();
            const next = committed(index);
            if (next !== rows) update(next, target.key);
            else inputs.current.get(target.key)?.focus();
        }
    };

    const onPaste = (event: React.ClipboardEvent<HTMLInputElement>, index: number) => {
        const text = event.clipboardData.getData('text/plain');
        if (!text.includes('\n')) return;
        event.preventDefault();
        const row = rows[index];
        const pasted = rowsFromText(text, row.depth).map(r => commitRowTokens(r, context));
        if (pasted.length === 0) return;
        const before = row.header === '' && !row.id ? rows.slice(0, index) : rows.slice(0, index + 1);
        update([...before, ...pasted, ...rows.slice(index + 1)], pasted[pasted.length - 1].key);
    };

    const onEstimateChange = (index: number, text: string) => {
        const parsed = parseDurationInput(text);
        const minutes = parsed.kind === 'ok' && parsed.minutes > 0 ? parsed.minutes : null;
        const error = parsed.kind === 'empty' ? undefined
            : minutes === null ? `“${text}” is not a duration. Use e.g. 3h, 1.5, 1:30 or 90m.` : undefined;
        update(replace(index, { ...rows[index], minutes, durationText: text, error }));
    };

    return (
        <Box role="list" aria-label="parts" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {rows.map((row, index) => {
                const budget = budgets.get(row.key);
                const label = `Part ${index + 1}`;
                return (
                    <Box key={row.key} role="listitem" data-testid="outline-row">
                        <Box sx={{
                            display: 'flex', alignItems: 'center', gap: 1, pl: row.depth * 3,
                            borderBottom: 1, borderColor: 'divider', py: 0.25,
                        }}>
                            <Typography variant="caption" color="text.secondary" sx={{ width: 20, textAlign: 'right', flexShrink: 0 }}>
                                {index + 1}
                            </Typography>
                            <InputBase
                                value={row.header}
                                disabled={row.done}
                                placeholder={index === 0 ? 'Name the first part, e.g. “CAD 3h”' : ''}
                                inputRef={(element: HTMLInputElement | null) => {
                                    if (element) inputs.current.set(row.key, element);
                                    else inputs.current.delete(row.key);
                                }}
                                onChange={event => update(replace(index, { ...row, header: event.target.value, error: undefined }))}
                                onBlur={() => { const next = committed(index); if (next !== rows) update(next); }}
                                onKeyDown={event => onHeaderKeyDown(event as React.KeyboardEvent<HTMLInputElement>, index)}
                                onPaste={event => onPaste(event as React.ClipboardEvent<HTMLInputElement>, index)}
                                inputProps={{ 'aria-label': label }}
                                sx={{ flex: 1, textDecoration: row.done ? 'line-through' : undefined }}
                            />
                            {row.tagIds?.map(id => <Chip key={id} size="small" variant="outlined" label={`#${tagNames.get(id) ?? id}`} />)}
                            {row.newTags?.map(name => <Chip key={name} size="small" color="secondary" variant="outlined" label={`#${name} (new)`} />)}
                            {row.priority !== undefined && <Chip size="small" variant="outlined" label={`!${row.priority}`} />}
                            {row.deadline && (
                                <Chip size="small" variant="outlined"
                                    label={`⏰ ${new Date(row.deadline).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}`} />
                            )}
                            {budget?.overBy ? (
                                <Typography variant="caption" color="warning.main">parts +{human(budget.overBy)}</Typography>
                            ) : null}
                            <InputBase
                                value={row.durationText ?? (row.minutes !== null ? minutesToText(row.minutes) : '')}
                                disabled={row.done}
                                placeholder={budget ? `~${human(budget.minutes)}` : ''}
                                onChange={event => onEstimateChange(index, event.target.value)}
                                inputProps={{ 'aria-label': `Estimate of ${label}`, inputMode: 'decimal' }}
                                sx={{
                                    width: 96, px: 1, borderRadius: 1, border: 1,
                                    borderColor: row.error ? 'error.main' : 'divider',
                                    '& input::placeholder': { fontStyle: 'italic' },
                                }}
                            />
                        </Box>
                        {row.error && (
                            <Typography variant="caption" color="error" sx={{ pl: row.depth * 3 + 3.5 }}>{row.error}</Typography>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}
