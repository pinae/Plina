import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@mui/material';
import { AppHeader } from './AppHeader';
import { seededClient } from '../../testing/treeFixtures';

function Seeded({ trackedId }: { trackedId: string | null }) {
    const [client] = useState(() => seededClient({ activeId: 'hw', trackedId }));
    return (
        <QueryClientProvider client={client}>
            <AppHeader actions={<Button variant="contained" size="small">Plan my week</Button>} />
        </QueryClientProvider>
    );
}

const meta: Meta<typeof Seeded> = {
    title: 'Header/AppHeader',
    component: Seeded,
    args: { trackedId: 'cad' },
    parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof Seeded>;

/** Keys: N = quick add, P = project picker, T = stop/start tracking. */
export const Tracking: Story = {};
export const Idle: Story = { args: { trackedId: null } };
