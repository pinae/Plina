/**
 * UI-8: the settings page (docs/task-entry-ui.md §6.1), opened with ⚙ in the
 * header: the account (who is logged in, logging out, the password), the
 * default duration used for tasks without an own estimate
 * (planning, Σ parts, split editor ghosts; changing it re-plans the accepted
 * plan on the server) and the time frame the Week view opens on, filling the
 * screen — usually the work hours.
 */
import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import type { AxiosError } from 'axios';

import { parseDurationInput } from '../TaskFormDialog/taskFormValidation.ts';
import { useSettings, useUpdateSettings } from '../../queries.tsx';
import { AccountSettings } from '../AccountSettings/AccountSettings.tsx';
import { minutesToText } from '../../utils/outline.ts';
import { minutesToDurationString, parseDurationMinutes } from '../../utils/duration.ts';
import { clockMinutes } from '../../utils/timeScale.ts';

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

/** "08:00:00" → "08:00" (what a time input shows); a fallback when missing. */
function clockText(value: string | undefined, fallback: string) {
    const minutes = clockMinutes(value);
    if (minutes === null) return fallback;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function WeekViewFrameForm({ start, end }: { start?: string; end?: string }) {
    const update = useUpdateSettings();
    const [from, setFrom] = useState(() => clockText(start, '08:00'));
    const [to, setTo] = useState(() => clockText(end, '16:45'));
    const [saved, setSaved] = useState<string | null>(null);
    const [serverError, setServerError] = useState<string | null>(null);

    const [fromMinutes, toMinutes] = [clockMinutes(from), clockMinutes(to)];
    const fromError = fromMinutes === null ? 'Enter a time, e.g. 08:00.' : null;
    const toError = toMinutes === null ? 'Enter a time, e.g. 16:45.'
        : fromMinutes !== null && toMinutes <= fromMinutes ? `The end must be after the start (${from}).` : null;
    const invalid = Boolean(fromError || toError);

    const edit = (setter: (value: string) => void) => (value: string) => {
        setter(value);
        setSaved(null);
        setServerError(null);
    };

    const save = () => {
        if (invalid) return;
        setSaved(null);
        setServerError(null);
        update.mutate({ week_view_start: from, week_view_end: to }, {
            onSuccess: () => setSaved(`${from}–${to}`),
            onError: caught => {
                const data = (caught as AxiosError<Record<string, string[]>>).response?.data;
                setServerError(data?.week_view_end?.[0] ?? data?.week_view_start?.[0]
                    ?? 'The time frame could not be saved. Please try again.');
            },
        });
    };

    const timeField = (label: string, value: string, onChange: (value: string) => void, error: string | null) => (
        <TextField
            label={label} type="time" value={value} error={Boolean(error)}
            onChange={event => onChange(event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 900 } }}
            sx={{ flex: 1 }}
        />
    );

    return (
        <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}
            onSubmit={event => { event.preventDefault(); save(); }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
                {timeField('From', from, edit(setFrom), fromError)}
                {timeField('To', to, edit(setTo), toError)}
            </Box>
            <Typography variant="body2" color={invalid || serverError ? 'error' : 'text.secondary'}>
                {fromError ?? toError ?? serverError
                    ?? 'The Week view opens on this time frame, filling the screen — usually your work hours.'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button type="submit" variant="contained" disabled={invalid || update.isPending}
                    sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>Save time frame</Button>
                {saved && <Alert severity="success" sx={{ py: 0 }}>Saved — the Week view opens on {saved}.</Alert>}
            </Box>
        </Box>
    );
}

export function SettingsPage() {
    const settings = useSettings();
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">Account</Typography>
            <AccountSettings />
            {settings.isSuccess ? <>
                <Typography variant="h6" sx={{ mt: 2 }}>Planning</Typography>
                <DefaultDurationForm initial={settings.data.default_duration} />
                <Typography variant="h6" sx={{ mt: 2 }}>Week view</Typography>
                <WeekViewFrameForm start={settings.data.week_view_start} end={settings.data.week_view_end} />
            </> : <CircularProgress aria-label="loading" size={24} />}
        </Box>
    );
}
