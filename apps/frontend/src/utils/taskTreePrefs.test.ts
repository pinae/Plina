import { afterEach, describe, expect, it } from 'vitest';

import { readCollapsed, readShowCompleted, storeCollapsed, storeShowCompleted } from './taskTreePrefs.ts';

afterEach(() => localStorage.clear());

describe('Tasks tab preferences (per browser)', () => {
    it('collapsed rows round-trip; default: nothing collapsed', () => {
        expect(readCollapsed()).toEqual(new Set());
        storeCollapsed(new Set(['a', 'b']));
        expect(readCollapsed()).toEqual(new Set(['a', 'b']));
    });

    it('"Show completed" round-trips; default off', () => {
        expect(readShowCompleted()).toBe(false);
        storeShowCompleted(true);
        expect(readShowCompleted()).toBe(true);
    });

    it('ignores garbage', () => {
        localStorage.setItem('plina.collapsedTasks', '{"x":1}');
        expect(readCollapsed()).toEqual(new Set());
    });
});
