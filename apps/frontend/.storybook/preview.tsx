import type { Preview } from '@storybook/react-vite';
import { CssBaseline, ThemeProvider } from '@mui/material';

import { appTheme } from '../src/theme';

/** Every story renders inside the app's (dark) MUI theme. */
const preview: Preview = {
    decorators: [
        (Story) => (
            <ThemeProvider theme={appTheme}>
                <CssBaseline />
                <Story />
            </ThemeProvider>
        ),
    ],
};

export default preview;
