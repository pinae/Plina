import React from 'react';
import { Box, CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from '../../theme.ts';

/** `pageScroll`: the app scrolls as a page and its header scrolls away (the
 *  Week on short screens, README: Week view on small screens). Else it is
 *  pinned to the screen and each pane scrolls inside. */
export default function Layout({ children, pageScroll = false }: { children: React.ReactNode; pageScroll?: boolean }) {
    return (
        <ThemeProvider theme={appTheme}>
            <CssBaseline />
            {/* No separate "Plina" header bar — the tab row is the top bar.
                Every pane uses the full screen width and the whole height. */}
            <Box data-testid="app-shell" data-scroll={pageScroll ? 'page' : 'pinned'}
                sx={pageScroll
                    // Never wider than the screen: a phone would zoom out to
                    // show it all, and the screen would no longer count as short.
                    ? { display: 'flex', flexDirection: 'column', minHeight: '100dvh', overflowX: 'clip' }
                    : { flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0, overflow: 'hidden' }}>
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', px: 0 }}>
                    {children}
                </Box>
            </Box>
        </ThemeProvider>
    );
}
