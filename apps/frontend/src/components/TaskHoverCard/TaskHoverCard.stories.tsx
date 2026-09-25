import type { Meta, StoryObj } from '@storybook/react';
import { TaskHoverCard } from './TaskHoverCard';
import type { ViewTask } from '../WeekViewTask/WeekViewTask';

const base: ViewTask = {
    title: 'Write the quarterly report for the board', startTime: '2026-07-08T09:00:00',
    duration: 90, color: '#3357ff', manuallySet: false, description: '',
    tags: [], continues: false, taskId: 't1',
};

const meta: Meta<typeof TaskHoverCard> = {
    title: 'Week/TaskHoverCard',
    component: TaskHoverCard,
    args: { task: base },
};

export default meta;
type Story = StoryObj<typeof TaskHoverCard>;

export const AutoPlanned: Story = {};
export const Appointment: Story = {
    args: { task: { ...base, title: 'Team sync', isAppointment: true, manuallySet: true, color: '#8833ff' } },
};
export const WithWarningsAndInvalid: Story = {
    args: { task: { ...base, description: 'Misses its deadline by 2 days', valid: false, continues: true } },
};
