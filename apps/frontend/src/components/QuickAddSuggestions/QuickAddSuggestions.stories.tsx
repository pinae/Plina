import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { QuickAddSuggestions } from './QuickAddSuggestions';
import { makerTag } from '../../testing/treeFixtures';

const meta: Meta<typeof QuickAddSuggestions> = {
    title: 'Header/QuickAddSuggestions',
    component: QuickAddSuggestions,
    parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export default meta;
type Story = StoryObj<typeof QuickAddSuggestions>;

const projects = [{ id: 'hw', label: 'Hardware Design' }, { id: 'blog', label: 'Company Blog' }, { id: 'milk', label: 'Buy milk' }];
const tags = [makerTag, { id: 'tag-writing', name: 'writing', hex_color: '#009688' }, { id: 'tag-errand', name: 'errand', hex_color: '#ff9800' }];

function InteractiveSuggestions() {
    const [parentId, setParentId] = useState<string | null>('hw');
    const [tagIds, setTagIds] = useState<string[]>(['tag-maker']);
    const [minutes, setMinutes] = useState<number | null>(30);
    return (
        <div style={{ maxWidth: 390 }}>
            <QuickAddSuggestions
                projects={projects} parentId={parentId} onParent={setParentId}
                tags={tags} tagIds={tagIds}
                onToggleTag={id => setTagIds(prev => (prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]))}
                minutes={minutes} onMinutes={setMinutes}
            />
        </div>
    );
}

/** Tappable chips of the quick-add sheet (phones); tap to try. */
export const Interactive: Story = { render: () => <InteractiveSuggestions /> };
