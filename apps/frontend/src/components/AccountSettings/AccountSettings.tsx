/**
 * The account section of the settings (README: Accounts): who is logged in,
 * logging out (after the single sign-on also at the provider) and a new
 * password for a Plina account.
 */
import { useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import type { AxiosError } from 'axios';

import { useChangePassword, useLogout, useSession } from '../../queries.tsx';

function PasswordForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
    const change = useChangePassword();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [repeat, setRepeat] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const mismatch = repeat !== '' && repeat !== next;

    const save = (event: React.FormEvent) => {
        event.preventDefault();
        setErrors({});
        change.mutate({ old_password: current, new_password: next }, {
            onSuccess: onSaved,
            onError: caught => {
                const data = (caught as AxiosError<Record<string, string[] | string>>).response?.data ?? {};
                const first = (key: string) => [data[key] ?? []].flat()[0];
                setErrors({
                    old_password: first('old_password') ?? '',
                    new_password: first('new_password') ?? '',
                    detail: first('detail') ?? (first('old_password') || first('new_password') ? ''
                        : 'The password could not be changed. Please try again.'),
                });
            },
        });
    };

    return (
        <Box component="form" onSubmit={save} sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}>
            <TextField label="Current password" type="password" autoComplete="current-password" value={current}
                error={Boolean(errors.old_password)} helperText={errors.old_password || undefined}
                onChange={event => setCurrent(event.target.value)} />
            <TextField label="New password" type="password" autoComplete="new-password" value={next}
                error={Boolean(errors.new_password)} helperText={errors.new_password || undefined}
                onChange={event => setNext(event.target.value)} />
            <TextField label="Repeat the new password" type="password" autoComplete="new-password" value={repeat}
                error={mismatch} helperText={mismatch ? 'The new passwords differ.' : undefined}
                onChange={event => setRepeat(event.target.value)} />
            {errors.detail && <Alert severity="error">{errors.detail}</Alert>}
            <Box sx={{ display: 'flex', gap: 1 }}>
                <Button type="submit" variant="contained"
                    disabled={!current || !next || repeat !== next || change.isPending}>Save password</Button>
                <Button onClick={onCancel}>Cancel</Button>
            </Box>
        </Box>
    );
}

export function AccountSettings() {
    const session = useSession();
    const logout = useLogout();
    const [changing, setChanging] = useState(false);
    const [changed, setChanged] = useState(false);
    const user = session.data?.user;
    if (!user) return null;
    const provider = session.data?.single_sign_on?.name;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="body1">
                Logged in as <b>{user.name}</b>{user.name !== user.username ? ` (${user.username})` : ''}
                {user.single_sign_on && provider ? ` with ${provider}` : ''}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button variant="outlined" startIcon={<LogoutIcon />} disabled={logout.isPending}
                    onClick={() => logout.mutate()}>
                    Log out
                </Button>
                {user.can_change_password && !changing && (
                    <Button onClick={() => { setChanging(true); setChanged(false); }}>Change password</Button>
                )}
                {changed && <Alert severity="success" sx={{ py: 0 }}>Password changed.</Alert>}
            </Box>
            {changing && (
                <PasswordForm onSaved={() => { setChanging(false); setChanged(true); }}
                    onCancel={() => setChanging(false)} />
            )}
        </Box>
    );
}
