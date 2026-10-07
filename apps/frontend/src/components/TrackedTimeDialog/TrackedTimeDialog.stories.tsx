import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrackedTimeDialog } from './TrackedTimeDialog';
import type { TrackedSession } from '../../types';
import { makeTask } from '../../testing/treeFixtures';

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const arbeit = { id: 'tag-arbeit', name: 'Arbeit', hex_color: '#3f51b5' };
const freizeit = { id: 'tag-freizeit', name: 'Freizeit', hex_color: '#43a047' };
const session = (id: string, header: string, start: string, end: string | null, tags = [arbeit]): TrackedSession => ({
    id, task_id: header, task_header: header, task_tags: tags, start, end, running: end === null,
    seconds: ((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000,
});
const report = makeTask('report', { header: 'Quarterly report' });

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
queryClient.setQueryData(['tasks'], [report]);
// Left running over night: 17:00 until the next morning.
queryClient.setQueryData(['sessions', { task: 'report' }], [
    session('a', 'Quarterly report', local(5, 9), local(5, 12, 30)),
    session('b', 'Quarterly report', local(6, 17), local(7, 9)),
]);
queryClient.setQueryData(['sessions', { from: '2026-10-06', to: '2026-10-06' }], [
    session('c', 'Quarterly report', local(6, 8, 15), local(6, 12)),
    session('d', 'Lunch', local(6, 12), local(6, 12, 45), [freizeit]),
    session('e', 'CAD model', local(6, 12, 45), local(6, 17, 0)),
]);

const meta: Meta<typeof TrackedTimeDialog> = {
    title: 'Pages/TrackedTimeDialog',
    component: TrackedTimeDialog,
    decorators: [
        (Story) => (
            <QueryClientProvider client={queryClient}>
                <Story />
            </QueryClientProvider>
        ),
    ],
    args: { onClose: () => {} },
};

export default meta;
type Story = StoryObj<typeof TrackedTimeDialog>;

/** From the task form: a night that ran on, to be cut back. */
export const ByTask: Story = { args: { task: report } };

/** From the time sheet: everything begun on a day. */
export const ByDay: Story = { args: { day: '2026-10-06' } };
