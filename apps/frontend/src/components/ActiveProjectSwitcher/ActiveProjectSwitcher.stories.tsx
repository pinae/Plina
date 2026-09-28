import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ActiveProjectSwitcher } from './ActiveProjectSwitcher';
import { seededClient } from '../../testing/treeFixtures';

function Switcher({ activeId, startOpen = false }: { activeId: string | null; startOpen?: boolean }) {
    const [client] = useState(() => seededClient({ activeId }));
    const [open, setOpen] = useState(startOpen);
    return (
        <QueryClientProvider client={client}>
            <ActiveProjectSwitcher open={open} onOpenChange={setOpen} onShowAllProjects={() => {}} />
        </QueryClientProvider>
    );
}

const meta: Meta<typeof Switcher> = {
    title: 'Header/ActiveProjectSwitcher',
    component: Switcher,
    args: { activeId: 'hw' },
};

export default meta;
type Story = StoryObj<typeof Switcher>;

/** Breadcrumb of a sub-project; click "T250" to widen the scope. */
export const InSubProject: Story = {};
export const NoProject: Story = { args: { activeId: null } };
/** The picker (▾ or P): type to filter, "No project", create a new one. */
export const PickerOpen: Story = { args: { startOpen: true } };
