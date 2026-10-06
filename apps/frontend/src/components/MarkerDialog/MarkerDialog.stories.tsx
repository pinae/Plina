import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarkerDialog } from './MarkerDialog';
import type { Marker } from '../../types';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
queryClient.setQueryData(['tags'], []);
queryClient.setQueryData(['settings'], {
    default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
    week_view_start: '08:00:00', week_view_end: '16:45:00',
});

const conference: Marker = {
    id: 'm-1', title: 'Maker Faire', description: 'Booth 12', place: 'Hannover',
    start: new Date(2026, 9, 20).toISOString(), duration: '3 00:00:00', end: new Date(2026, 9, 23).toISOString(),
    all_day: true, calendar: { id: 'cal-1', name: 'Google Calendar' }, deadline_task_count: 3,
};

const meta: Meta<typeof MarkerDialog> = {
    title: 'Calendar/MarkerDialog',
    component: MarkerDialog,
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
type Story = StoryObj<typeof MarkerDialog>;

/** A click on a day's lane in the Week view: a new all-day marker. */
export const NewMarker: Story = { args: { day: new Date(2026, 9, 20) } };

/** An all-day event from the calendar, the deadline of three tasks. */
export const FromCalendar: Story = { args: { marker: conference } };

/** A deadline at a moment. */
export const Deadline: Story = {
    args: {
        marker: {
            ...conference, id: 'm-2', title: 'Paper deadline', all_day: false, duration: '00:00:00',
            start: new Date(2026, 9, 31, 23, 59).toISOString(), end: new Date(2026, 9, 31, 23, 59).toISOString(),
            calendar: null, deadline_task_count: 0, description: '', place: '',
        },
    },
};
