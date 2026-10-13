/**
 * The Tasks tab's inline inputs. Each keeps what is typed to itself: a
 * keystroke renders the input and nothing else (README: Performance). The
 * outline hears of the text only when it is committed (Enter, or leaving the
 * estimate field) and answers with an error to show, or null when done.
 */
import { memo, useRef, useState } from 'react';
import { Box, TextField } from '@mui/material';

/** What a commit answers: an error to show, or null (done). */
export type CommitResult = Promise<string | null> | string | null;

export interface InlineEditFieldProps {
    field: 'header' | 'estimate';
    /** The text the edit starts with. */
    initialText: string;
    /** Accessible name of the input. */
    label: string;
    onCommit: (text: string) => CommitResult;
    onCancel: () => void;
}

/** Edits a row's header (all quick-add tokens work) or its estimate. */
export const InlineEditField = memo(function InlineEditField({
    field, initialText, label, onCommit, onCancel,
}: InlineEditFieldProps) {
    const [text, setText] = useState(initialText);
    const [error, setError] = useState<string | null>(null);
    // A commit returns the focus to the tree, which blurs the field: that
    // blur must not save a second time.
    const committing = useRef(false);
    const commit = async () => {
        if (committing.current) return;
        committing.current = true;
        const problem = await onCommit(text);
        if (problem) { setError(problem); committing.current = false; }
    };
    return (
        <TextField size="small" autoFocus value={text} error={error !== null}
            fullWidth={field === 'header'}
            helperText={field === 'header' ? error ?? undefined : undefined}
            onChange={event => { setText(event.target.value); setError(null); }}
            onKeyDown={event => {
                // The outline's keys stay out of the input.
                event.stopPropagation();
                if (event.key === 'Enter') { event.preventDefault(); void commit(); }
                if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
            }}
            onBlur={field === 'estimate' ? () => void commit() : undefined}
            slotProps={{ htmlInput: { 'aria-label': label, ...(field === 'estimate' ? { inputMode: 'decimal' } : {}) } }}
            sx={field === 'estimate' ? { width: 110 } : undefined} />
    );
});

export interface DraftRowProps {
    depth: number;
    /** Enter with text: create the task. Null keeps the row open, empty, for the next one. */
    onSubmit: (text: string) => CommitResult;
    /** Esc, Enter on an empty row, or leaving it empty; ``refocus`` returns to the tree. */
    onClose: (refocus: boolean) => void;
}

/** "+ Add task" opened: a row to type a new task into (Enter adds it). */
export const DraftRow = memo(function DraftRow({ depth, onSubmit, onClose }: DraftRowProps) {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const submit = async () => {
        if (!text.trim()) { onClose(true); return; }
        const problem = await onSubmit(text);
        if (problem) setError(problem);
        else setText('');
    };
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 + depth * 3 + 7.5, pr: 1, py: 0.5 }}>
            <TextField size="small" fullWidth autoFocus value={text} error={error !== null}
                helperText={error ?? 'Enter adds the task (e.g. “assembly 2h #maker”), Esc stops'}
                placeholder="New task…"
                onChange={event => { setText(event.target.value); setError(null); }}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Enter') { event.preventDefault(); void submit(); }
                    if (event.key === 'Escape') { event.preventDefault(); onClose(true); }
                }}
                onBlur={() => { if (!text.trim()) onClose(false); }}
                slotProps={{ htmlInput: { 'aria-label': 'New task' } }} />
        </Box>
    );
});
