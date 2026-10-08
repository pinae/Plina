import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { splitTaskAcrossDays } from './taskSplitter';
import type { ViewTask } from '../components/WeekViewTask/WeekViewTask.tsx';

// Helper to create a task
const createTask = (title: string, startIso: string, duration: number): ViewTask => ({
    title,
    startTime: startIso, // Expecting ISO string like '2024-02-12T10:00:00.000Z'
    duration,
    color: 'red',
    manuallySet: false,
    description: '',
    tags: [],
    continues: false
});

/** A moment in the device's time zone (the Week view's days are local). */
const local = (day: number, hour: number, minute = 0) => new Date(2024, 1, day, hour, minute).toISOString();

describe('splitTaskAcrossDays', () => {
    it('returns the same task if it fits within one day', () => {
        // Mon 10:00 - 11:00
        const task = createTask('Simple', local(12, 10), 60);
        const result = splitTaskAcrossDays(task);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(task);
    });

    it('returns the same task if it ends exactly at midnight (next day 00:00)', () => {
        // Mon 23:00 - Tue 00:00 (60 mins)
        const start = local(12, 23);
        const result = splitTaskAcrossDays(createTask('Ends Midnight', start, 60));

        expect(result).toHaveLength(1);
        expect(result[0].duration).toBe(60);
        expect(result[0].startTime).toBe(start);
    });

    it('does not split if task starts at 00:00', () => {
        // Tue 00:00 - 01:00
        const start = local(13, 0);
        const result = splitTaskAcrossDays(createTask('Starts Midnight', start, 60));

        expect(result).toHaveLength(1);
        expect(result[0].duration).toBe(60);
        expect(result[0].startTime).toBe(start);
    });

    it('splits a task crossing midnight into two segments', () => {
        // Mon 23:00 - Tue 01:30 (150 mins total)
        const start = local(12, 23);
        const result = splitTaskAcrossDays(createTask('Split', start, 150));

        expect(result).toHaveLength(2);

        // Segment 1: Mon 23:00 - 24:00 (60 mins)
        expect(result[0].startTime).toBe(start);
        expect(result[0].duration).toBe(60);
        expect(result[0].continues).toBe(true);

        // Segment 2: Tue 00:00 - 01:30 (90 mins)
        expect(result[1].startTime).toBe(local(13, 0));
        expect(result[1].duration).toBe(90);
        expect(result[1].continues).toBe(false);
    });

    it('splits a multi-day task into multiple full-day segments', () => {
        // Mon 22:00 - Wed 02:00
        const start = local(12, 22);
        const result = splitTaskAcrossDays(createTask('Multi Day', start, 1680));

        expect(result).toHaveLength(3);

        // 1. Mon 22:00 - 24:00 (120m)
        expect(result[0].duration).toBe(120);
        expect(result[0].continues).toBe(true);
        expect(result[0].startTime).toBe(start);

        // 2. Tue 00:00 - 24:00 (1440m)
        expect(result[1].duration).toBe(1440);
        expect(result[1].continues).toBe(true);
        expect(result[1].startTime).toBe(local(13, 0));

        // 3. Wed 00:00 - 02:00 (120m)
        expect(result[2].duration).toBe(120);
        expect(result[2].continues).toBe(false);
        expect(result[2].startTime).toBe(local(14, 0));
    });

    describe('in a time zone other than UTC (the days are the device’s)', () => {
        const zone = process.env.TZ;
        beforeEach(() => { process.env.TZ = 'Europe/Berlin'; });
        afterEach(() => { process.env.TZ = zone; });

        it('splits at local midnight', () => {
            // 23:00 to 01:00 in Berlin: 21:00 to 23:00 UTC — no UTC midnight in it.
            const task = createTask('Late', '2024-02-12T22:00:00.000Z', 120);
            const result = splitTaskAcrossDays(task);

            expect(result.map(segment => [new Date(segment.startTime).getHours(), segment.duration]))
                .toEqual([[23, 60], [0, 60]]);
            expect(result[0].continues).toBe(true);
        });

        it('leaves a task over UTC midnight in one piece', () => {
            // 00:30 to 02:30 in Berlin: one day there.
            const result = splitTaskAcrossDays(createTask('Early', '2024-02-12T23:30:00.000Z', 120));
            expect(result).toHaveLength(1);
        });
    });

    it('keeps fractions of minutes (seconds) exactly', () => {
        const start = new Date(2024, 1, 12, 23, 59, 30).toISOString();
        const result = splitTaskAcrossDays(createTask('Seconds', start, 1.5));
        expect(result.map(segment => segment.duration)).toEqual([0.5, 1]);
    });
});
