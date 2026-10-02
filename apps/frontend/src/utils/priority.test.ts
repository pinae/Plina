import { describe, expect, it } from 'vitest';

import { priorityBand } from './priority.ts';

describe('priorityBand (Todoist-like colours, docs/tasks-tab.md §3.1)', () => {
    it.each([
        [0, 'low'], [3, 'low'], [4, 'normal'], [6, 'normal'], [7, 'high'], [8, 'high'], [9, 'urgent'], [10, 'urgent'],
    ])('%i → %s', (priority, band) => {
        expect(priorityBand(priority)).toBe(band);
    });
});
