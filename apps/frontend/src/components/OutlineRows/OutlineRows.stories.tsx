import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Box } from '@mui/material';
import { OutlineRows } from './OutlineRows';
import { newRow, type OutlineRow } from '../../utils/outline';
import { computeBudgets } from '../../utils/splitMath';

const context = { now: new Date(), tags: [{ id: 'tag-maker', name: 'maker' }], projects: [] };

function Rows({ initial }: { initial: OutlineRow[] }) {
    const [rows, setRows] = useState(initial);
    return (
        <Box sx={{ width: 640, p: 2 }}>
            <OutlineRows rows={rows} budgets={computeBudgets(rows, 720, 60)} onChange={setRows} context={context} />
        </Box>
    );
}

const meta: Meta<typeof Rows> = { title: 'Split/OutlineRows', component: Rows };
export default meta;
type Story = StoryObj<typeof Rows>;

/** Try Enter, Tab / Shift+Tab, Alt+↑/↓, "CAD 3h #maker", or paste a list. */
export const Nested: Story = {
    args: {
        initial: [
            { ...newRow(0, 'CAD'), minutes: 180, tagIds: ['tag-maker'] },
            newRow(1, 'housing'), { ...newRow(1, 'mount'), minutes: 45 },
            newRow(0, 'test prints'), newRow(0, 'assembly'),
        ],
    },
};
export const Empty: Story = { args: { initial: [newRow(0)] } };
