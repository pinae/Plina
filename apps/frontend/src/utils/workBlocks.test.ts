import { describe, expect, it } from 'vitest';

import { ranLong, shares, weightMinutes, type ShareInput } from './workBlocks.ts';

const done = (estimate: number, over: Partial<ShareInput> = {}): ShareInput => ({
    estimateMinutes: estimate, spentElsewhereMinutes: 0, completed: true, pinnedMinutes: null, ...over,
});
const minutesOf = (total: number, ...items: ShareInput[]) => {
    const result = shares(total * 60, items);
    if ('error' in result) throw new Error(result.error);
    return result.seconds.map(seconds => seconds / 60);
};

/** The same cases as the backend's (services.work_blocks.shares, docs/sort-time.md S2). */
describe('shares of a work block', () => {
    it('by estimate, scaled to fill the block', () => {
        expect(minutesOf(180, done(60), done(30))).toEqual([120, 60]);
    });

    it('time tracked elsewhere counts what is left, at least a quarter', () => {
        expect(minutesOf(120, done(120, { spentElsewhereMinutes: 60 }), done(60))).toEqual([60, 60]);
        expect(minutesOf(120, done(60, { spentElsewhereMinutes: 90 }), done(45))).toEqual([30, 90]);
    });

    it('worked on counts half', () => {
        expect(weightMinutes(done(60, { completed: false }))).toBe(30);
        expect(minutesOf(90, done(60), done(60, { completed: false }))).toEqual([60, 30]);
    });

    it('pinned minutes stay and the rest scales; all pinned leaves the rest', () => {
        expect(minutesOf(150, done(60, { pinnedMinutes: 30 }), done(60), done(30))).toEqual([30, 80, 40]);
        expect(minutesOf(120, done(60, { pinnedMinutes: 30 }), done(60, { pinnedMinutes: 45 }))).toEqual([30, 45]);
    });

    it('refuses pinned minutes beyond the block', () => {
        expect(shares(120 * 60, [done(60, { pinnedMinutes: 90 }), done(60, { pinnedMinutes: 45 })]))
            .toEqual({ error: 'The minutes typed add up to 2h 15m, more than the 2h to share.' });
    });

    it('whole minutes that add up exactly', () => {
        const total = 2 * 3600 + 13 * 60 + 37;
        const result = shares(total, [done(10), done(10), done(10)]);
        if ('error' in result) throw new Error(result.error);
        expect(result.seconds.reduce((a, b) => a + b, 0)).toBe(total);
        expect(result.seconds.slice(0, -1).every(seconds => seconds % 60 === 0)).toBe(true);
    });

    it('without weight, evenly', () => {
        expect(minutesOf(60, done(0), done(0))).toEqual([30, 30]);
    });
});

describe('a session that ran long (“Only this task?”)', () => {
    // Header: 1h estimate, 10m tracked before this session.
    const task = { duration: '01:00:00', time_spent: '01:40:00' };
    const session = (minutes: number) => ({ seconds: minutes * 60 });

    it('over 1.5× what was left of the estimate when it began', () => {
        expect(ranLong(session(90), task, 60)).toBe(true); // 50m were left
        expect(ranLong(session(70), { ...task, time_spent: '01:20:00' }, 60)).toBe(false); // 70m of 50m
    });

    it('not for short sessions, and the default duration without an estimate', () => {
        expect(ranLong(session(20), { duration: '00:05:00', time_spent: '00:20:00' }, 60)).toBe(false);
        expect(ranLong(session(100), { duration: null, time_spent: '01:40:00' }, 60)).toBe(true);
        expect(ranLong(session(80), { duration: null, time_spent: '01:20:00' }, 60)).toBe(false);
    });
});
