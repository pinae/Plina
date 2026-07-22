import React from 'react';
import { AppBar, Toolbar, Typography, Box, CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from '../../theme.ts';

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider theme={appTheme}>
            <CssBaseline />
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
                <AppBar position="static">
                    <Toolbar>
                        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                            Plina
                        </Typography>
                    </Toolbar>
                </AppBar>
                {/* Every pane (calendar, dependency graph, lists) uses the full
                    screen width — no more middle-column narrowing. */}
                <Box sx={{ mt: 4, flex: 1, display: 'flex', flexDirection: 'column', width: '100%', px: 0 }}>
                    {children}
                </Box>
            </Box>
        </ThemeProvider>
    );
}
