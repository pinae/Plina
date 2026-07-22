import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TagList from './TagList';
import type { Tag } from '../../types';

const sampleTags: Tag[] = [
    { id: 'tag-1', name: 'deep-work', hex_color: '#3f51b5' },
    { id: 'tag-2', name: 'errands', hex_color: '#e91e63' },
    { id: 'tag-3', name: 'meetings', hex_color: '#009688' },
];

// Seed the query cache so the pane renders sample data without a backend.
const queryClient = new QueryClient();
queryClient.setQueryData(['tags'], sampleTags);

const meta: Meta<typeof TagList> = {
    title: 'Panes/TagList',
    component: TagList,
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
type Story = StoryObj<typeof TagList>;

export const Default: Story = {};
