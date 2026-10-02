import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { PrioritySlider } from './PrioritySlider';

function Live({ initial, compact }: { initial: number; compact?: boolean }) {
    const [value, setValue] = useState(initial);
    return <PrioritySlider value={value} label="CAD" onCommit={setValue} compact={compact} />;
}

const meta: Meta<typeof Live> = {
    title: 'Outline/PrioritySlider',
    component: Live,
    args: { initial: 7 },
};

export default meta;
type Story = StoryObj<typeof Live>;

/** Click or drag; the colour follows the band (grey, blue, orange, red). */
export const Desktop: Story = {};
export const Urgent: Story = { args: { initial: 10 } };
export const Low: Story = { args: { initial: 2 } };
/** Phones: a chip that opens the slider in a popover. */
export const Compact: Story = { args: { compact: true } };
