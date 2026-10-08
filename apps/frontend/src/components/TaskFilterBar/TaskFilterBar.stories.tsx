import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { TaskFilterBar } from './TaskFilterBar';
import { EMPTY_FILTER, type TaskFilter } from '../../utils/taskFilter';

const projects = [
    { id: 't250', header: 'T250', path: 'T250', depth: 0, color: '#e91e63' },
    { id: 'hw', header: 'Hardware Design', path: 'T250 › Hardware Design', depth: 1, color: '#e91e63' },
    { id: 'blog', header: 'Company Blog', path: 'Company Blog', depth: 0, color: '#3f51b5' },
];
const tags = [{ id: 'maker', name: 'maker', hex_color: '#3f51b5' }, { id: 'writing', name: 'writing', hex_color: '#25984d' }];

function Live({ initial }: { initial: TaskFilter }) {
    const [filter, setFilter] = useState(initial);
    return <TaskFilterBar filter={filter} onChange={setFilter} projects={projects} tags={tags} matchCount={12} totalCount={87} />;
}

const meta: Meta<typeof Live> = {
    title: 'Outline/TaskFilterBar',
    component: Live,
    args: { initial: EMPTY_FILTER },
};

export default meta;
type Story = StoryObj<typeof Live>;

/** Nothing on: the search and one button per filter. Phones (≤ 600 px): a
 *  filter button opening a bottom sheet. */
export const Empty: Story = {};
/** Each button says what it is set to; the count and Clear follow. */
export const Filtered: Story = {
    args: { initial: { ...EMPTY_FILTER, search: 'cad', projects: ['t250'], tags: ['maker'], priority: [7, 10] } },
};
