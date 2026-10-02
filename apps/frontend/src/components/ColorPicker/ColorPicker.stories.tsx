import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ColorPicker } from './ColorPicker';

function Live({ initial, ...props }: {
    initial: string | null; defaultColor: string | null; automatic: boolean; others?: string; chosenHint?: string;
}) {
    const [value, setValue] = useState(initial);
    return <ColorPicker value={value} onChange={setValue} {...props} />;
}

const meta: Meta<typeof Live> = {
    title: 'Forms/ColorPicker',
    component: Live,
    args: { initial: null, defaultColor: '#8489da', automatic: false },
};

export default meta;
type Story = StoryObj<typeof Live>;

/** A subtask: by default it shows its parent's color. */
export const FromParent: Story = {};
/** A project: by default an automatic color unlike the other projects'. */
export const Automatic: Story = { args: { automatic: true, defaultColor: '#9f7100' } };
/** A new project: its automatic color is picked when it is saved. */
export const NewProject: Story = { args: { automatic: true, defaultColor: null } };
export const Chosen: Story = { args: { initial: '#25984d' } };
export const Custom: Story = { args: { initial: '#123456' } };
/** A time bucket type: automatic, unlike the other time buckets' colors. */
export const TimeBucket: Story = {
    args: { automatic: true, defaultColor: '#af8e2a', others: 'time buckets',
        chosenHint: 'Every bucket of this type shows it.' },
};
