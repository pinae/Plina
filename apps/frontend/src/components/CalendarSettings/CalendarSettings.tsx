/**
 * The calendars Plina reads (README: Calendar), in the settings: add one by
 * its secret iCal address (Google Calendar: Settings → the calendar →
 * "Secret address in iCal format"), see when it was read last and whether
 * that worked, read it now, remove it. Timed events become appointments,
 * all-day events markers; the app reads the calendars every few minutes.
 */
import { useState } from 'react';
import type { AxiosError } from 'axios';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List, ListItem,
    ListItemText, TextField, Typography,
} from '@mui/material';
import EventIcon from '@mui/icons-material/Event';

import { useCalendars, useCreateCalendar, useDeleteCalendar, useSession, useSyncCalendars } from '../../queries.tsx';
import type { CalendarSubscription } from '../../types.ts';

const fieldError = (failure: Error | null, field: string): string | undefined => {
    const data = (failure as AxiosError<Record<string, string[]>> | null)?.response?.data;
    const value = data?.[field];
    return Array.isArray(value) ? value[0] : undefined;
};

function AddCalendarForm({ onDone }: { onDone: () => void }) {
    const session = useSession();
    const create = useCreateCalendar();
    const [name, setName] = useState('Google Calendar');
    const [url, setUrl] = useState('');
    // null: the address of the session, once it is there.
    const [ownEmail, setEmail] = useState<string | null>(null);
    const email = ownEmail ?? session.data?.user?.email ?? '';
    const urlError = fieldError(create.error, 'url');

    return (
        <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}
            onSubmit={event => {
                event.preventDefault();
                if (!name.trim() || !url.trim()) return;
                create.mutate({ name: name.trim(), url: url.trim(), email: email.trim() }, { onSuccess: onDone });
            }}>
            <TextField label="Name" value={name} required onChange={event => setName(event.target.value)} />
            <TextField label="Secret address in iCal format" value={url} required type="password"
                autoComplete="off" error={Boolean(urlError)}
                helperText={urlError ?? 'Google Calendar: Settings → your calendar → “Integrate calendar” → '
                    + '“Secret address in iCal format”. Whoever has it can read the calendar: Plina keeps it secret.'}
                onChange={event => setUrl(event.target.value)} />
            <TextField label="Your address in that calendar" value={email} type="email"
                helperText="Events you declined are left out; those you answered “maybe” come in unplanned."
                onChange={event => setEmail(event.target.value)} />
            <Box sx={{ display: 'flex', gap: 1 }}>
                <Button type="submit" variant="contained" disabled={create.isPending}>Add and read</Button>
                <Button onClick={onDone}>Cancel</Button>
            </Box>
        </Box>
    );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}) : 'not yet');

export function CalendarSettings() {
    const calendars = useCalendars();
    const sync = useSyncCalendars();
    const remove = useDeleteCalendar();
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<CalendarSubscription | null>(null);
    const list = calendars.data ?? [];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
                Plina reads these calendars every few minutes while it is open: timed events become appointments,
                all-day events markers. Invitations you get there arrive here too. Merge one with a task of yours
                in the Week view (“Merge tasks”).
            </Typography>
            {list.length > 0 && (
                <List dense sx={{ maxWidth: 640, bgcolor: 'background.paper', borderRadius: 1 }}>
                    {list.map(calendar => (
                        <ListItem key={calendar.id} divider secondaryAction={
                            <Button color="error" size="small" onClick={() => setRemoving(calendar)}>Remove</Button>
                        }>
                            <EventIcon sx={{ mr: 1.5, color: calendar.hex_color }} />
                            <ListItemText
                                primary={calendar.name}
                                secondary={calendar.last_error
                                    ? <Typography component="span" variant="body2" color="error">{calendar.last_error}</Typography>
                                    : `${calendar.url_hint} · read ${when(calendar.last_synced_at)}`} />
                        </ListItem>
                    ))}
                </List>
            )}
            {adding ? <AddCalendarForm onDone={() => setAdding(false)} /> : (
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button variant="outlined" onClick={() => setAdding(true)}>Add a calendar</Button>
                    {list.length > 0 && (
                        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
                            {sync.isPending ? 'Reading…' : 'Read now'}
                        </Button>
                    )}
                </Box>
            )}
            {removing && (
                <Dialog open onClose={() => setRemoving(null)} maxWidth="xs">
                    <DialogTitle>Remove “{removing.name}”?</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            Its coming events that nobody worked on are removed from Plina. Past ones, merged ones
                            and those with tracked time stay as your own tasks.
                        </DialogContentText>
                        {remove.isError && <Alert severity="error" sx={{ mt: 2 }}>The calendar could not be removed.</Alert>}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setRemoving(null)}>Cancel</Button>
                        <Button color="error" variant="contained" disabled={remove.isPending}
                            onClick={() => remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}>
                            Remove
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
        </Box>
    );
}
