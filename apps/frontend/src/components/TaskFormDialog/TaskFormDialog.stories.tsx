import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskFormDialog } from './TaskFormDialog';
import type { Project, Tag, Task } from '../../types';

const tags: Tag[] = [
    { id: 'tag-1', name: 'deep-work', hex_color: '#3f51b5' },
    { id: 'tag-2', name: 'errands', hex_color: '#e91e63' },
];
const projects: Project[] = [
    { id: 'proj-1', name: 'Webshop', description: '', tags: [], priority: 8, order: 0, task_ids: [], hex_color: null },
];

// Seed the query cache so the selects are populated without a backend.
const queryClient = new QueryClient();
queryClient.setQueryData(['tags'], tags);
queryClient.setQueryData(['projects'], projects);

const meta: Meta<typeof TaskFormDialog> = {
    title: 'Forms/TaskFormDialog',
    component: TaskFormDialog,
    decorators: [
        (Story) => (
            <QueryClientProvider client={queryClient}>
                <Story />
            </QueryClientProvider>
        ),
    ],
    args: { open: true, onClose: () => {} },
};

export default meta;
type Story = StoryObj<typeof TaskFormDialog>;

/** Empty form — press "Create" to see the validation messages and outlines. */
export const NewTask: Story = {};

/** Drag-created appointment with start + duration prefilled. */
export const DragCreatedAppointment: Story = {
    args: {
        initialStart: new Date('2026-07-08T10:00:00'),
        initialDurationMinutes: 90,
        defaultAppointment: true,
    },
};

const existing: Task = {
    id: 'task-1', header: 'Write report', description: '', start_date: null,
    duration: '01:20:00', latest_finish_date: null, time_spent: '00:00:00', priority: 6,
    tags: [tags[0]], hex_color: null, is_fixed: false, is_appointment: false,
    completed_at: null, is_done: false, active_tracking_start: null, project_id: 'proj-1',
};

/** Editing an existing task (duration shown as 1:20). */
export const EditTask: Story = { args: { task: existing } };
