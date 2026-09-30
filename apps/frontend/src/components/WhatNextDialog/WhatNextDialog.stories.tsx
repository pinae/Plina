import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WhatNextDialog } from './WhatNextDialog';
import { makeAlternative } from '../../testing/treeFixtures';

const meta: Meta<typeof WhatNextDialog> = {
    title: 'Week/WhatNextDialog',
    component: WhatNextDialog,
    decorators: [(Story) => <QueryClientProvider client={new QueryClient()}><Story /></QueryClientProvider>],
    args: {
        alternatives: [makeAlternative('a', 'Continue T250'), makeAlternative('b', 'Switch to the blog')],
        onClose: () => {},
    },
};

export default meta;
type Story = StoryObj<typeof WhatNextDialog>;

/** After completing a task, when the plan forks. */
export const TwoChoices: Story = {};

/** The completed task was the last open part: its parents completed too.
 *  The Undo sits in the dialog (a snackbar behind the modal is unreachable). */
export const WithParentsCompleted: Story = {
    args: { autoCompleted: [{ id: 'hw', header: 'Hardware Design' }, { id: 't250', header: 'T250' }] },
};
