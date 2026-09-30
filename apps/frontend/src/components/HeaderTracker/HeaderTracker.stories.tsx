import type { Meta, StoryObj } from '@storybook/react';
import { HeaderTracker } from './HeaderTracker';
import type { TrackerControls } from '../../hooks/useTracker';
import { makeTask } from '../../testing/treeFixtures';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const noop = () => {};
const base: TrackerControls = {
    tracked: null, outsidePath: null, next: null,
    pickable: {
        inProject: [makeTask('cad', { header: 'CAD' }), makeTask('prints', { header: 'test prints' })],
        others: [makeTask('milk', { header: 'Buy milk' })],
    },
    defaultDurationMinutes: 60, start: noop, stop: noop, complete: noop, toggle: noop,
    pending: false, error: null, clearError: noop,
};

const meta: Meta<typeof HeaderTracker> = {
    title: 'Header/HeaderTracker',
    component: HeaderTracker,
    args: { controls: base, onEditTask: noop },
};

export default meta;
type Story = StoryObj<typeof HeaderTracker>;

export const Tracking: Story = {
    args: { controls: { ...base, tracked: makeTask('cad', { header: 'CAD', duration: '03:00:00', active_tracking_start: minutesAgo(42) }) } },
};
/** Past the estimate: amber timer with "+0:12 over". */
export const OverEstimate: Story = {
    args: { controls: { ...base, tracked: makeTask('cad', { header: 'CAD', duration: '01:00:00', time_spent: '00:30:00', active_tracking_start: minutesAgo(42) }) } },
};
export const OutsideActiveProject: Story = {
    args: { controls: { ...base, outsidePath: 'T250 › Hardware Design', tracked: makeTask('cad', { header: 'CAD', active_tracking_start: minutesAgo(5) }) } },
};
export const IdleWithNext: Story = {
    args: { controls: { ...base, next: { task_id: 'cad', header: 'CAD', start_time: minutesAgo(-30), duration: 3600, warnings: [], is_fixed: false, is_appointment: false, hex_color: null } } },
};
export const IdleNothingPlanned: Story = {};
export const BlockedStart: Story = {
    args: { controls: { ...base, error: 'Can’t start yet — first finish “Design schema”.' } },
};
/** Phones (UI-9): ⏹ time ✓ — tap the time to open the task. */
export const CompactTracking: Story = {
    args: { compact: true, controls: { ...base, tracked: makeTask('cad', { header: 'CAD', active_tracking_start: minutesAgo(42) }) } },
};
export const CompactIdleWithNext: Story = {
    args: { compact: true, controls: IdleWithNext.args!.controls },
};
