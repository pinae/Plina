import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Box } from '@mui/material';
import { QuickAdd } from './QuickAdd';
import { seededClient } from '../../testing/treeFixtures';

function Seeded({ activeId }: { activeId: string | null }) {
    const [client] = useState(() => seededClient({ activeId }));
    return (
        <QueryClientProvider client={client}>
            <Box sx={{ width: 520, p: 2 }}><QuickAdd /></Box>
        </QueryClientProvider>
    );
}

const meta: Meta<typeof Seeded> = {
    title: 'Header/QuickAdd',
    component: Seeded,
    args: { activeId: 'hw' },
};

export default meta;
type Story = StoryObj<typeof Seeded>;

/** Type e.g. "Order filament 30m #maker !7 >fri" to see the chips. */
export const InActiveProject: Story = {};
export const NoActiveProject: Story = { args: { activeId: null } };
