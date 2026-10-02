import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { QuickAddSheet } from './QuickAddSheet';
import { seededClient } from '../../testing/treeFixtures';

const meta: Meta<typeof QuickAddSheet> = {
    title: 'Header/QuickAddSheet',
    component: QuickAddSheet,
    parameters: { viewport: { defaultViewport: 'mobile1' } },
    decorators: [(Story) => <QueryClientProvider client={seededClient()}><Story /></QueryClientProvider>],
};

export default meta;
type Story = StoryObj<typeof QuickAddSheet>;

function Sheet({ initiallyOpen }: { initiallyOpen: boolean }) {
    const [open, setOpen] = useState(initiallyOpen);
    return <QuickAddSheet open={open} onOpenChange={setOpen} />;
}

/** Phones: the ⊕ button in the corner. */
export const Closed: Story = { render: () => <Sheet initiallyOpen={false} /> };

/** The sheet: type a name, tap project, tags and estimate, Add. */
export const Open: Story = { render: () => <Sheet initiallyOpen /> };
