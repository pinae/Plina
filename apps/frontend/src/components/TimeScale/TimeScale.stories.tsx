import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import { TimeScale } from './TimeScale';

const meta: Meta<typeof TimeScale> = {
    title: 'Week/TimeScale',
    component: TimeScale,
    decorators: [
        (Story) => (
            <Box sx={{ display: 'flex', bgcolor: '#111' }}>
                <Story />
            </Box>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof TimeScale>;

/** A very slim window (6.5 px per hour): every 4th hour. */
export const VerySlim: Story = { args: { columnHeight: 156 } };

/** A low-resolution screen (15.6 px per hour): every 2nd hour. */
export const LowResolution: Story = { args: { columnHeight: 375 } };

/** A big screen (34 px per hour): every hour. */
export const BigScreen: Story = { args: { columnHeight: 815 } };

/** Zoomed in (100 px per hour): every half hour, the full hours brighter. */
export const ZoomedIn: Story = { args: { columnHeight: 2400 } };
