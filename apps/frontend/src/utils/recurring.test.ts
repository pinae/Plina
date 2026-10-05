import { describe, expect, it } from 'vitest';

import { makeTask } from '../testing/treeFixtures.ts';
import { dueFrom, recurrenceSummary, withoutLaterOccurrences } from './recurring.ts';

const NOW = new Date('2026-10-05T09:00:00+02:00');
const occurrence = (id: string, date: string, over = {}) => makeTask(id, {
    header: 'Jour fixe', series_id: 's1', occurrence: date, is_appointment: true,
    recurrence: 'every tuesday 20:00', recurrence_description: 'every Tuesday at 20:00', occurrence_count: 4, ...over,
});

describe('recurring tasks in the Tasks tab', () => {
    it('lists only the next of the occurrences still ahead', () => {
        const tasks = [
            occurrence('past-open', '2026-09-29T20:00:00+02:00'),
            occurrence('done', '2026-09-22T20:00:00+02:00', { is_done: true, completed_at: '2026-09-22T21:00:00+02:00' }),
            occurrence('later', '2026-10-13T20:00:00+02:00'),
            occurrence('next', '2026-10-06T20:00:00+02:00'),
            makeTask('plain'),
        ];
        expect(withoutLaterOccurrences(tasks, NOW).map(t => t.id)).toEqual(['past-open', 'done', 'next', 'plain']);
    });

    it('says what the rule is and when the next one comes', () => {
        const task = occurrence('next', '2026-10-06T20:00:00+02:00', { next_occurrence: '2026-10-13T20:00:00+02:00' });
        expect(recurrenceSummary(task)).toMatch(/^every Tuesday at 20:00 · next: .*13/);
    });

    it('a task occurrence not due yet says from when', () => {
        const chore = occurrence('chore', '2026-10-06T20:00:00+02:00', { is_appointment: false });
        expect(dueFrom(chore, NOW)).toMatch(/^from .*06/);
        expect(dueFrom(chore, new Date('2026-10-07T00:00:00+02:00'))).toBeNull();
        expect(dueFrom({ ...chore, is_appointment: true }, NOW)).toBeNull();
    });
});
