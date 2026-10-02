import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Box } from '@mui/material';
import { OutlineView } from './OutlineView';
import { makeTask, seededClient, treeTasks } from '../../testing/treeFixtures';

function Outline({ activeId }: { activeId: string | null }) {
    const [client] = useState(() => {
        const seeded = seededClient({ activeId });
        seeded.setQueryData(['tasks'], [
            ...treeTasks(),
            makeTask('milk', { header: 'Buy milk', duration: null, is_estimated: false, order: 5 }),
        ]);
        return seeded;
    });
    return (
        <QueryClientProvider client={client}>
            <Box sx={{ p: 2 }}><OutlineView /></Box>
        </QueryClientProvider>
    );
}

const meta: Meta<typeof Outline> = {
    title: 'Outline/OutlineView', component: Outline, args: { activeId: 't250' },
    parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof Outline>;

/** The active project on top; click a row for its dialog (↑/↓ inside walk
 *  the tree), the "?" lists the keys. */
export const ActiveProject: Story = {};
export const NoActiveProject: Story = { args: { activeId: null } };
