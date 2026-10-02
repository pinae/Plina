/**
 * UI-8: the settings page (docs/task-entry-ui.md §6.1), opened with ⚙ in the
 * header. For now one setting: the default duration used for tasks without
 * an own estimate (planning, Σ parts, split editor ghosts). Changing it
 * re-plans the accepted plan on the server.
 */
import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import type { AxiosError } from 'axios';

import { parseDurationInput } from '../TaskFormDialog/taskFormValidation.ts';
import { useSettings, useUpdateSettings } from '../../queries.tsx';
import { minutesToText } from '../../utils/outline.ts';
import { minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';

function DefaultDurationForm({ initial }: { initial: string }) {
    const update = useUpdateSettings();
    const [text, setText] = useState(() => minutesToText(parseDurationMinutes(initial) ?? 60));
    const [saved, setSaved] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);

    const parsed = parseDurationInput(text);
    const error = parsed.kind === 'empty' ? 'Enter a duration, e.g. 1h or 30m.'
        : parsed.kind === 'invalid' ? `“${text}” is not a duration. Use e.g. 1h, 1.5, 1:30 or 45m.`
            : parsed.minutes <= 0 ? 'The default duration must be longer than 0 minutes.' : null;

    const save = () => {
        if (error || parsed.kind !== 'ok') return;
        setSaved(false);
        setServerError(null);
        update.mutate({ default_duration: minutesToDurationString(parsed.minutes) }, {
            onSuccess: () => setSaved(true),
            onError: caught => {
                const data = (caught as AxiosError<Record<string, string[]>>).response?.data;
                setServerError(data?.default_duration?.[0] ?? 'The setting could not be saved. Please try again.');
            },
        });
    };

    return (
        <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}
            onSubmit={event => { event.preventDefault(); save(); }}>
            <TextField
                label="Default duration" value={text} error={Boolean(error || serverError)}
                helperText={error ?? serverError ?? 'Used for tasks without an own estimate — in planning, Σ parts and the split editor.'}
                onChange={event => { setText(event.target.value); setSaved(false); setServerError(null); }}
                slotProps={{ htmlInput: { 'aria-label': 'Default duration', inputMode: 'decimal' } }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button type="submit" variant="contained" disabled={Boolean(error) || update.isPending}>Save</Button>
                {saved && <Alert severity="success" sx={{ py: 0 }}>Saved — unestimated tasks are re-planned.</Alert>}
            </Box>
        </Box>
    );
}

export function SettingsPage() {
    const settings = useSettings();
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">Planning</Typography>
            {settings.isSuccess
                ? <DefaultDurationForm initial={settings.data.default_duration} />
                : <CircularProgress aria-label="loading" size={24} />}
        </Box>
    );
}
