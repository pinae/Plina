import { describe, expect, it } from 'vitest';

import type { PlanWarning } from '../types.ts';
import { whyUnplanned } from './planWarnings.ts';

const warning = (over: Partial<PlanWarning>): PlanWarning => ({
    task_id: 't', header: 'Text überarbeiten', kind: 'unplanned_within_horizon', deadline: null,
    projected_finish: null, missing_minutes: 200, waits_for: null, only_tags: [], ...over,
});

describe('whyUnplanned', () => {
    it('says how much finds no place, and why', () => {
        expect(whyUnplanned(warning({}))).toBe('3h 20m of it find no place in the time buckets of the next 60 days: they are full');
        expect(whyUnplanned(warning({ waits_for: 'Huge' }))).toMatch(/: it waits for “Huge”, which doesn't fit either$/);
        expect(whyUnplanned(warning({ only_tags: ['Freizeit', 'Lesen'] })))
            .toMatch(/: it goes only into the buckets tagged #Freizeit or #Lesen$/);
    });

    it('a plan stored before it knew why: the buckets of the next 60 days', () => {
        const old = warning({});
        delete old.missing_minutes;
        expect(whyUnplanned(old)).toBe("doesn't fit into the time buckets of the next 60 days");
    });
});
