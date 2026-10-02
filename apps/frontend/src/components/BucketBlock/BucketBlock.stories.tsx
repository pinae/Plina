import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import { BucketBlock } from './BucketBlock';
import type { DayZone } from '../../utils/planToWeek';

const zone: DayZone = {
    id: 'b1', start: new Date('2026-07-08T09:00:00'), end: new Date('2026-07-08T13:00:00'),
    color: '#539dad', label: 'Deep Work', persisted: true, typeId: 1,
    topMinutes: 540, heightMinutes: 240,
};

const meta: Meta<typeof BucketBlock> = {
    title: 'Week/BucketBlock',
    component: BucketBlock,
    decorators: [
        (Story) => (
            <Box sx={{ position: 'relative', width: 120, height: 1440, bgcolor: '#111' }}>
                <Story />
            </Box>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof BucketBlock>;

export const Default: Story = {
    args: { zone, columnHeight: 1440 },
};
