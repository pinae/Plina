import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import { AllocationBar } from './AllocationBar';

const meta: Meta<typeof AllocationBar> = {
    title: 'Split/AllocationBar',
    component: AllocationBar,
    decorators: [(Story) => <Box sx={{ width: 640, p: 2 }}><Story /></Box>],
};

export default meta;
type Story = StoryObj<typeof AllocationBar>;

const parts = [
    { kind: 'explicit' as const, minutes: 180, label: 'CAD' },
    { kind: 'explicit' as const, minutes: 120, label: 'test prints' },
    { kind: 'ghost' as const, minutes: 150, label: 'orders' },
];

export const WithRest: Story = {
    args: { allocation: { segments: [...parts, { kind: 'unassigned', minutes: 120 }], available: 570, partsTotal: 450, unassigned: 120, overBy: 0 } },
};
export const SpentAndOverBudget: Story = {
    args: { allocation: { segments: [{ kind: 'spent', minutes: 60 }, ...parts, { kind: 'over', minutes: 105 }], available: 345, partsTotal: 450, unassigned: 0, overBy: 105 } },
};
