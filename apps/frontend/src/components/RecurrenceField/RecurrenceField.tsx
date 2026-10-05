/**
 * A recurrence rule in plain language with a live preview (README: Recurring
 * tasks): while typing, the server says the rule in its words and lists the
 * next occurrences — or explains what it does not understand. Shared by the
 * task form ("Repeats") and the time bucket form ("Recurrence").
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, List, ListItem, TextField, Typography } from '@mui/material';
import RepeatIcon from '@mui/icons-material/Repeat';

import type { RecurrencePreview } from '../../types.ts';

const PREVIEW_DEBOUNCE_MS = 300;

export interface RecurrenceFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** Asks the server; rejects with ``{ detail }`` for a rule it does not understand. */
    preview: (text: string) => Promise<RecurrencePreview>;
    placeholder?: string;
    /** Shown while the field is empty. */
    helperText?: string;
    required?: boolean;
    /** The server's refusal after saving. */
    error?: string;
    /** Changes of e.g. the appointment's start: asks again. */
    previewKey?: string;
}

const formatOccurrence = (iso: string) => new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function RecurrenceField({
    label, value, onChange, preview, placeholder, helperText, required, error, previewKey,
}: RecurrenceFieldProps) {
    const [result, setResult] = useState<RecurrencePreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
    // The latest preview function, without restarting the debounce on every render.
    const ask = useRef(preview);
    useEffect(() => { ask.current = preview; });

    const change = (text: string) => {
        onChange(text);
        // An emptied rule has no preview (cleared here, not in the effect).
        if (!text.trim()) {
            setResult(null);
            setPreviewError(null);
        }
    };

    // Live preview: server-parsed occurrences, debounced while typing.
    useEffect(() => {
        clearTimeout(debounce.current);
        if (!value.trim()) return;
        let current = true;
        debounce.current = setTimeout(() => {
            ask.current(value)
                .then(found => {
                    if (!current) return;
                    setResult(found);
                    setPreviewError(null);
                })
                .catch(failure => {
                    if (!current) return;
                    setResult(null);
                    setPreviewError(failure?.response?.data?.detail ?? 'Could not preview the recurrence rule.');
                });
        }, PREVIEW_DEBOUNCE_MS);
        return () => {
            current = false;
            clearTimeout(debounce.current);
        };
    }, [value, previewKey]);

    const message = error ?? previewError;
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <TextField
                label={label} value={value} placeholder={placeholder} required={required}
                error={Boolean(error)}
                helperText={value.trim() ? undefined : helperText}
                onChange={event => change(event.target.value)}
            />
            {message && <Alert severity="error">{message}</Alert>}
            {!message && result && value.trim() && (
                <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1 }}>
                    <Typography variant="body2" data-testid="recurrence-description"
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <RepeatIcon fontSize="inherit" /> {result.description}
                    </Typography>
                    <List dense disablePadding>
                        {result.occurrences.map(occurrence => (
                            <ListItem key={occurrence} disableGutters data-testid="preview-occurrence">
                                {formatOccurrence(occurrence)}
                            </ListItem>
                        ))}
                    </List>
                </Box>
            )}
        </Box>
    );
}
