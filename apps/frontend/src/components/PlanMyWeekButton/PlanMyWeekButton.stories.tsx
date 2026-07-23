import type { Meta, StoryObj } from '@storybook/react';
import { PlanMyWeekButton } from './PlanMyWeekButton';

const meta: Meta<typeof PlanMyWeekButton> = {
    title: 'Week/PlanMyWeekButton',
    component: PlanMyWeekButton,
    args: { dirty: false, dragging: false, onTrigger: () => {}, onClick: () => {} },
};

export default meta;
type Story = StoryObj<typeof PlanMyWeekButton>;

export const Idle: Story = {};
export const Dirty: Story = { args: { dirty: true } };
export const DirtyWhileDragging: Story = { args: { dirty: true, dragging: true } };
