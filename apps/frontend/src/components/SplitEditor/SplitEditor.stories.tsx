import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { SplitEditor } from './SplitEditor';
import { makeTask, seededClient, treeTasks } from '../../testing/treeFixtures';
import type { Task } from '../../types';

function Editor({ task, extra = [] }: { task: Task; extra?: Task[] }) {
    const [client] = useState(() => {
        const seeded = seededClient();
        seeded.setQueryData(['tasks'], [...treeTasks(), ...extra]);
        return seeded;
    });
    return (
        <QueryClientProvider client={client}>
            <SplitEditor open task={task} onClose={() => {}} />
        </QueryClientProvider>
    );
}

const meta: Meta<typeof Editor> = { title: 'Split/SplitEditor', component: Editor };
export default meta;
type Story = StoryObj<typeof Editor>;

/** A fresh 12h task: type part names and watch the ghost shares. */
export const FreshSplit: Story = {
    args: { task: makeTask('solo', { header: 'Hardware Design', duration: '12:00:00', priority: 7 }) },
};

const parts = [['CAD', '03:00:00'], ['test prints', '02:15:00'], ['component orders', '02:15:00'],
    ['CAD refinements', '02:15:00'], ['assembly', '04:00:00']] as const;
/** Existing parts whose sum exceeds the estimate by 1h 45m. */
export const OverBudget: Story = {
    args: {
        task: makeTask('hw2', { header: 'Hardware Design', duration: '12:00:00', children_ids: parts.map((_, i) => `x${i}`) }),
        extra: parts.map(([header, duration], i) =>
            makeTask(`x${i}`, { header, duration, parent_id: 'hw2', ancestor_ids: ['hw2'], order: i })),
    },
};
