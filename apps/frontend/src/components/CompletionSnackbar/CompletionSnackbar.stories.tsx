import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompletionSnackbar } from './CompletionSnackbar';

const meta: Meta<typeof CompletionSnackbar> = {
    title: 'Week/CompletionSnackbar',
    component: CompletionSnackbar,
    decorators: [(Story) => <QueryClientProvider client={new QueryClient()}><Story /></QueryClientProvider>],
    args: { onClose: () => {} },
};
export default meta;
type Story = StoryObj<typeof CompletionSnackbar>;

/** The last open subtask was completed: its parent completed too. */
export const ParentCompleted: Story = { args: { autoCompleted: [{ id: 'hw', header: 'Hardware Design' }] } };
/** A cascade: the snackbar names the topmost completed task. */
export const Cascade: Story = {
    args: { autoCompleted: [{ id: 'hw', header: 'Hardware Design' }, { id: 't250', header: 'T250' }] },
};
