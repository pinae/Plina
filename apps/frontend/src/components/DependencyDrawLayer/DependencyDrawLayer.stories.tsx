import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import { DependencyDrawLayer } from './DependencyDrawLayer';

const meta: Meta<typeof DependencyDrawLayer> = {
    title: 'Tasks/DependencyDrawLayer',
    component: DependencyDrawLayer,
    decorators: [(Story) => <Box sx={{ height: 320 }}><Story /></Box>],
};
export default meta;
type Story = StoryObj<typeof DependencyDrawLayer>;

/** Over a task: a release makes the start task depend on it. */
export const OnTarget: Story = {
    args: { from: { x: 80, y: 60 }, to: { x: 260, y: 200 }, label: '“Firmware” depends on “CAD”', onTarget: true },
};

/** Between the rows: nothing would happen yet. */
export const Searching: Story = {
    args: { from: { x: 80, y: 60 }, to: { x: 300, y: 140 }, label: 'Drop on the task “Firmware” depends on', onTarget: false },
};
