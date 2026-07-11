import React from 'react';
import { AppBar, Toolbar, Typography, Container, Box, CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from '../../theme.ts';

export default function Layout({ children, fullWidth = false }: { children: React.ReactNode; fullWidth?: boolean }) {
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
                {fullWidth ? (
                    <Box sx={{ mt: 4, flex: 1, display: 'flex', flexDirection: 'column', width: '100%', px: 0 }}>
                        {children}
                    </Box>
                ) : (
                    <Container maxWidth="lg" sx={{ mt: 4, flex: 1, display: 'flex', flexDirection: 'column' }}>
                        {children}
                    </Container>
                )}
            </Box>
        </ThemeProvider>
    );
}
