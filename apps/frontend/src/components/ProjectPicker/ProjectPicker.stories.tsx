import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from '@mui/material';
import { ProjectPicker } from './ProjectPicker';

const projects = [
    { id: 't250', header: 'T250', path: 'T250', depth: 0, color: '#e91e63' },
    { id: 'hw', header: 'Hardware Design', path: 'T250 › Hardware Design', depth: 1, color: null },
    { id: 'blog', header: 'Company Blog', path: 'Company Blog', depth: 0, color: null },
];

function Picker({ allowCreate }: { allowCreate: boolean }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
        <>
            <Button ref={setAnchor} variant="outlined">Anchor</Button>
            <ProjectPicker open anchorEl={anchor} onClose={() => {}} onPick={() => {}}
                projects={projects} noneLabel="Top level — make it a project of its own" allowCreate={allowCreate} />
        </>
    );
}

const meta: Meta<typeof Picker> = { title: 'Header/ProjectPicker', component: Picker, args: { allowCreate: false } };
export default meta;
type Story = StoryObj<typeof Picker>;

/** "Move to…" in the outline (M). */
export const MoveTo: Story = {};
/** The active project switcher (can create a project). */
export const WithCreate: Story = { args: { allowCreate: true } };
