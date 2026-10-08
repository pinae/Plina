import type { Meta, StoryObj } from '@storybook/react';
import { PlanMyWeekButton } from './PlanMyWeekButton';

const meta: Meta<typeof PlanMyWeekButton> = {
    title: 'Week/PlanMyWeekButton',
    component: PlanMyWeekButton,
    args: { onClick: () => {} },
};

export default meta;
type Story = StoryObj<typeof PlanMyWeekButton>;

export const Idle: Story = {};
/** Phones (UI-9): icon only. */
export const Compact: Story = { args: { compact: true } };
