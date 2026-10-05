/**
 * The app opens only for a logged-in user (README: Accounts); logged out, the
 * login page. Any 401 means the session ended (expired, or logged out in
 * another tab): the session is fetched again, which shows the login page.
 */
import { useEffect, type ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';

import { onUnauthorized } from '../../api.ts';
import { queryKeys, useSession } from '../../queries.tsx';
import { LoginPage } from '../LoginPage/LoginPage.tsx';

export function AuthGate({ children }: { children: ReactNode }) {
    const session = useSession();
    const client = useQueryClient();
    useEffect(() => onUnauthorized(() => {
        client.invalidateQueries({ queryKey: queryKeys.session });
    }), [client]);

    if (session.isPending) {
        return (
            <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
                <CircularProgress aria-label="loading" />
            </Box>
        );
    }
    if (session.isError) {
        return (
            <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
                <Alert severity="error" action={
                    <Button color="inherit" size="small" onClick={() => session.refetch()}>Try again</Button>}>
                    Cannot reach Plina's server.
                </Alert>
            </Box>
        );
    }
    if (!session.data.authenticated) {
        return <LoginPage singleSignOn={session.data.single_sign_on} passwordResetUrl={session.data.password_reset_url} />;
    }
    return <>{children}</>;
}
