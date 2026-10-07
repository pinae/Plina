import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MergeDialog } from './MergeDialog';
import type { Task } from '../../types';
import { makeTask } from '../../testing/treeFixtures';

const event = {
    header: 'Project kickoff with Acme', description: 'Agenda: scope, milestones, budget.',
    place: 'Acme HQ, Room 4.12', start: '2026-10-14T08:00:00Z', end: '2026-10-14T09:30:00Z', all_day: false,
};
const mine: Task = makeTask('mine', {
    header: 'Kickoff Acme', description: 'Bring the slides and the contract draft.', is_appointment: true,
    start_date: '2026-10-14T08:00:00Z', duration: '01:00:00', priority: 8,
});
const invitation: Task = makeTask('invitation', {
    header: event.header, description: event.description, place: event.place, is_appointment: true,
    start_date: event.start, duration: '01:30:00',
    calendar: { id: 'link-1', name: 'Google Calendar', event, pending: [] },
});
const followed: Task = {
    ...mine, place: event.place,
    calendar: { id: 'link-1', name: 'Google Calendar', event, pending: ['header', 'description'] },
};

// Seed the query cache so the dialog renders without a backend.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
queryClient.setQueryData(['tags'], []);
queryClient.setQueryData(['tasks'], [mine, invitation]);

const meta: Meta<typeof MergeDialog> = {
    title: 'Calendar/MergeDialog',
    component: MergeDialog,
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
type Story = StoryObj<typeof MergeDialog>;

/** Your task and the invitation of the same meeting: the arrows copy a field into the result. */
export const MergeWithInvitation: Story = { args: { kept: mine, other: invitation } };

/** "Compare": the calendar changed the title and description, Plina kept yours. */
export const CompareWithCalendar: Story = { args: { kept: followed } };
