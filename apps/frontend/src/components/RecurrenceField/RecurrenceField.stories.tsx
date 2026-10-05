import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { RecurrenceField } from './RecurrenceField';
import type { RecurrencePreview } from '../../types';

/** A stand-in for the server: understands two rules, refuses the rest. */
const fakePreview = (text: string): Promise<RecurrencePreview> => {
    const rules: Record<string, RecurrencePreview> = {
        'every tuesday 20:00': {
            description: 'every Tuesday at 20:00',
            occurrences: ['2026-10-06T20:00:00+02:00', '2026-10-13T20:00:00+02:00', '2026-10-20T20:00:00+02:00'],
        },
        'every first sunday each month at 12:30': {
            description: 'every first Sunday of the month at 12:30',
            occurrences: ['2026-11-01T12:30:00+01:00', '2026-12-06T12:30:00+01:00', '2027-01-03T12:30:00+01:00'],
        },
    };
    const found = rules[text.trim().toLowerCase()];
    return found ? Promise.resolve(found) : Promise.reject({ response: { data: {
        detail: `Plina does not understand “${text}”. Try e.g. “every tuesday at 20:00”.`,
    } } });
};

function Live({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return (
        <RecurrenceField label="Repeats" value={value} onChange={setValue} preview={fakePreview}
            placeholder="every tuesday at 20:00" helperText="Empty = once" />
    );
}

const meta: Meta<typeof Live> = {
    title: 'Forms/RecurrenceField',
    component: Live,
    args: { initial: 'every tuesday 20:00' },
};

export default meta;
type Story = StoryObj<typeof Live>;

/** The rule in Plina's words and the next dates, while typing. */
export const Weekly: Story = {};
export const Monthly: Story = { args: { initial: 'every first sunday each month at 12:30' } };
/** What it does not understand, it says. */
export const NotUnderstood: Story = { args: { initial: 'every sometimes' } };
export const Empty: Story = { args: { initial: '' } };
