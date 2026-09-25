import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import { WeekViewTask, type ViewTask } from './WeekViewTask';

const base: ViewTask = {
    title: 'Write the quarterly report for the board', startTime: '2026-07-08T09:00:00',
    duration: 120, color: '#3357ff', manuallySet: true, description: 'Collect numbers from finance first.',
    tags: ['#e91e63'], continues: false, taskId: 't1',
};

const meta: Meta<typeof WeekViewTask> = {
    title: 'Week/WeekViewTask',
    component: WeekViewTask,
    // A single day column scaled to 1440px (1px per minute).
    decorators: [
        (Story) => (
            <Box sx={{ position: 'relative', width: 160, height: 1440, ml: 2 }}>
                <Story />
            </Box>
        ),
    ],
    args: { task: base, columnHeight: 1440, onEdit: () => {} },
};

export default meta;
type Story = StoryObj<typeof WeekViewTask>;

/** Tall enough for title and description — hovering shows no overlay. */
export const FitsItsContent: Story = {};

/** 15 minutes tall: the content is cut off, so hovering with the mouse shows
 *  the full details in an overlay (not on touch devices). */
export const TooSmallShowsOverlayOnHover: Story = {
    args: { task: { ...base, duration: 15 } },
};

/** Auto-planned (dashed, 80% opacity) and too small. */
export const AutoPlannedTooSmall: Story = {
    args: { task: { ...base, duration: 20, manuallySet: false, color: '#33aa66' } },
};
