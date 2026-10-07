import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TimeSheet from './TimeSheet';
import type { TimeSheet as Sheet, TimeSheetDay } from '../../types';

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const arbeit = { id: 'tag-arbeit', name: 'Arbeit', hex_color: '#3f51b5' };
const maker = { id: 'tag-maker', name: 'maker', hex_color: '#e91e63' };
const freizeit = { id: 'tag-freizeit', name: 'Freizeit', hex_color: '#4caf50' };

const day = (date: number, begin: [number, number], end: [number, number], pauseMinutes: number): TimeSheetDay => {
    const working = ((end[0] - begin[0]) * 60 + end[1] - begin[1] - pauseMinutes) * 60;
    return {
        date: `2026-10-${String(date).padStart(2, '0')}`, begin: local(date, ...begin), end: local(date, ...end),
        running: false, pause_seconds: pauseMinutes * 60, working_seconds: working,
        entries: [
            { task_id: `report-${date}`, header: 'Quarterly report', tags: [arbeit], kind: 'work',
                seconds: working * 0.6, running: false },
            { task_id: `lunch-${date}`, header: 'Lunch', tags: [freizeit], kind: 'pause',
                seconds: pauseMinutes * 60, running: false },
            { task_id: `cad-${date}`, header: 'CAD model of the housing', tags: [arbeit, maker], kind: 'work',
                seconds: working * 0.4, running: false },
        ],
    };
};

const sheet: Sheet = {
    from: '2026-10-01', to: '2026-10-31', work_tags: ['Arbeit', 'Work'], pause_tags: ['Freizeit', 'Freetime'],
    days: [day(1, [8, 15], [17, 0], 45), day(2, [9, 0], [15, 30], 30), day(5, [8, 0], [16, 45], 60),
        { ...day(6, [8, 30], [11, 50], 0), running: true }],
};

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
queryClient.setQueryData(['timesheet', '2026-10-01', '2026-10-31'], sheet);

const meta: Meta<typeof TimeSheet> = {
    title: 'Pages/TimeSheet',
    component: TimeSheet,
    decorators: [
        (Story) => (
            <QueryClientProvider client={queryClient}>
                <Story />
            </QueryClientProvider>
        ),
    ],
    args: { initialMonth: new Date(2026, 9, 1) },
};

export default meta;
type Story = StoryObj<typeof TimeSheet>;

/** October with four days of work, the last one still running. */
export const Month: Story = {};
