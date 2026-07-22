import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectList from './ProjectList';
import type { Project } from '../../types';

const sampleProjects: Project[] = [
    {
        id: 'proj-1', name: 'Webshop', description: 'Online store rebuild',
        tags: [{ id: 'tag-1', name: 'client', hex_color: '#3f51b5' }],
        priority: 8, order: 0, task_ids: [], hex_color: '#3f51b5',
    },
    {
        id: 'proj-2', name: 'Garden', description: '',
        tags: [], priority: 3, order: 1, task_ids: [], hex_color: null,
    },
];

// Seed the query cache so the pane renders sample data without a backend.
const queryClient = new QueryClient();
queryClient.setQueryData(['projects'], sampleProjects);

const meta: Meta<typeof ProjectList> = {
    title: 'Panes/ProjectList',
    component: ProjectList,
    decorators: [
        (Story) => (
            <QueryClientProvider client={queryClient}>
                <Story />
            </QueryClientProvider>
        ),
    ],
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ProjectList>;

export const Default: Story = {};
