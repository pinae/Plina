import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BucketTypeList from './BucketTypeList';
import type { TimeBucketType } from '../../types';

const sampleBucketTypes: TimeBucketType[] = [
    {
        id: 1, name: 'Morning Focus', start_times: 'every weekday at 09:00',
        duration: '04:00:00',
        tags: [{ id: 'tag-1', name: 'deep-work', hex_color: '#3f51b5' }],
        hex_color: '#3f51b5',
    },
    {
        id: 2, name: 'Evening Errands', start_times: 'every day at 18:00',
        duration: '01:30:00', tags: [], hex_color: null,
    },
];

// Seed the query cache so the pane renders sample data without a backend.
const queryClient = new QueryClient();
queryClient.setQueryData(['bucketTypes'], sampleBucketTypes);

const meta: Meta<typeof BucketTypeList> = {
    title: 'Panes/BucketTypeList',
    component: BucketTypeList,
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
type Story = StoryObj<typeof BucketTypeList>;

export const Default: Story = {};
