/**
 * The login page (README: Accounts): the single sign-on when the server has
 * one, and a Plina account (user name and password) always.
 */
import { useState } from 'react';
import { Alert, Box, Button, Divider, Link, Paper, TextField, Typography } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import type { AxiosError } from 'axios';

import { backendUrl } from '../../api.ts';
import { useLogin } from '../../queries.tsx';
import type { Session } from '../../types.ts';

/** A failed single sign-on comes back with ?login=failed: say it once, and
 *  take the marker out of the address. */
function takeFailedMarker(): boolean {
    const url = new URL(window.location.href);
    if (url.searchParams.get('login') !== 'failed') return false;
    url.searchParams.delete('login');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    return true;
}

export interface LoginPageProps {
    singleSignOn: Session['single_sign_on'];
    /** Django's password reset by mail, when the server can send mail. */
    passwordResetUrl?: string | null;
}

export function LoginPage({ singleSignOn, passwordResetUrl }: LoginPageProps) {
    const login = useLogin();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [ssoFailed] = useState(takeFailedMarker);

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        login.mutate({ username: username.trim(), password }, {
            onError: caught => {
                const detail = (caught as AxiosError<{ detail?: string }>).response?.data?.detail;
                setError(detail ?? 'Logging in did not work. Please try again.');
                setPassword('');
            },
        });
    };

    // Back to this very page after the provider.
    const ssoHref = singleSignOn
        ? `${backendUrl(singleSignOn.login_url)}?next=${encodeURIComponent(window.location.href)}`
        : null;

    return (
        <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
            <Paper elevation={3} sx={{ p: { xs: 2.5, sm: 4 }, width: '100%', maxWidth: 400 }}>
                <Typography variant="h5" component="h1" gutterBottom>Log in to Plina</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Your tasks, projects and time buckets — your plan.
                </Typography>
                {ssoFailed && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        The single sign-on did not work. Please try again.
                    </Alert>
                )}
                {singleSignOn && ssoHref && (
                    <>
                        <Button variant="contained" fullWidth size="large" href={ssoHref} startIcon={<LoginIcon />}>
                            Log in with {singleSignOn.name}
                        </Button>
                        <Divider sx={{ my: 3, typography: 'caption', color: 'text.secondary' }}>
                            or with a Plina account
                        </Divider>
                    </>
                )}
                <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField label="User name" value={username} autoComplete="username" required
                        autoFocus={!singleSignOn} onChange={event => setUsername(event.target.value)} />
                    <TextField label="Password" type="password" value={password} autoComplete="current-password"
                        required onChange={event => setPassword(event.target.value)} />
                    {error && <Alert severity="error">{error}</Alert>}
                    <Button type="submit" variant={singleSignOn ? 'outlined' : 'contained'} size="large"
                        disabled={login.isPending || !username.trim() || !password}>
                        Log in
                    </Button>
                    {passwordResetUrl && (
                        <Link href={backendUrl(passwordResetUrl)} variant="body2" sx={{ alignSelf: 'center' }}>
                            Forgot your password?
                        </Link>
                    )}
                </Box>
            </Paper>
        </Box>
    );
}
