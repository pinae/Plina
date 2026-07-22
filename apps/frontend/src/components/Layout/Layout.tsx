import React from 'react';
import { Box, CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from '../../theme.ts';

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider theme={appTheme}>
            <CssBaseline />
            {/* No separate "Plina" header bar — the tab row is the top bar.
                Every pane uses the full screen width and the whole height. */}
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0, overflow: 'hidden' }}>
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', px: 0 }}>
                    {children}
                </Box>
            </Box>
        </ThemeProvider>
    );
}
