import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { TaskColorPicker } from './TaskColorPicker';

function Live({ initial, inheritedColor, topLevel }: {
    initial: string | null; inheritedColor: string | null; topLevel: boolean;
}) {
    const [value, setValue] = useState(initial);
    return <TaskColorPicker value={value} inheritedColor={inheritedColor} topLevel={topLevel} onChange={setValue} />;
}

const meta: Meta<typeof Live> = {
    title: 'Tasks/TaskColorPicker',
    component: Live,
    args: { initial: null, inheritedColor: '#8489da', topLevel: false },
};

export default meta;
type Story = StoryObj<typeof Live>;

/** A subtask: by default it shows its parent's color. */
export const FromParent: Story = {};
/** A project: by default an automatic color unlike the other projects'. */
export const Automatic: Story = { args: { topLevel: true, inheritedColor: '#9f7100' } };
/** A new project: its automatic color is picked when it is saved. */
export const NewProject: Story = { args: { topLevel: true, inheritedColor: null } };
export const Chosen: Story = { args: { initial: '#25984d' } };
export const Custom: Story = { args: { initial: '#123456' } };
