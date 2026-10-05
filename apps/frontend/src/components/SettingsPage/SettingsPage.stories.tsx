import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Box } from '@mui/material';
import { SettingsPage } from './SettingsPage';
import { seededClient } from '../../testing/treeFixtures';

function Page() {
    const [client] = useState(() => seededClient());
    return (
        <QueryClientProvider client={client}>
            <Box sx={{ p: 2, width: 520 }}><SettingsPage /></Box>
        </QueryClientProvider>
    );
}

const meta: Meta<typeof Page> = { title: 'Settings/SettingsPage', component: Page };
export default meta;
type Story = StoryObj<typeof Page>;

/** ⚙ in the header: the default duration for unestimated tasks and the
 *  time frame the Week view opens on (08:00–16:45 by default). */
export const Default: Story = {};
