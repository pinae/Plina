import { describe, it, expect } from 'vitest';
import { splitTaskAcrossDays } from './taskSplitter';
import type { ViewTask } from '../components/WeekViewTask';

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

describe('splitTaskAcrossDays', () => {
    it('returns the same task if it fits within one day', () => {
        // Mon 10:00 - 11:00 UTC
        const start = '2024-02-12T10:00:00.000Z';
        const task = createTask('Simple', start, 60);
        const result = splitTaskAcrossDays(task);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(task);
    });

    it('returns the same task if it ends exactly at midnight (next day 00:00)', () => {
        // Mon 23:00 - Tue 00:00 UTC (60 mins)
        const start = '2024-02-12T23:00:00.000Z';
        const task = createTask('Ends Midnight', start, 60);
        const result = splitTaskAcrossDays(task);

        expect(result).toHaveLength(1);
        expect(result[0].duration).toBe(60);
        expect(result[0].startTime).toBe(start);
    });

    it('does not split if task starts at 00:00', () => {
        // Tue 00:00 - 01:00 UTC
        const start = '2024-02-13T00:00:00.000Z';
        const task = createTask('Starts Midnight', start, 60);
        const result = splitTaskAcrossDays(task);

        expect(result).toHaveLength(1);
        expect(result[0].duration).toBe(60);
        expect(result[0].startTime).toBe(start);
    });

    it('splits a task crossing midnight into two segments', () => {
        // Mon 23:00 UTC - Tue 01:30 UTC (150 mins total)
        const start = '2024-02-12T23:00:00.000Z';
        const task = createTask('Split', start, 150);
        const result = splitTaskAcrossDays(task);

        expect(result).toHaveLength(2);

        // Segment 1: Mon 23:00 - 24:00 (60 mins)
        expect(result[0].startTime).toBe(start);
        expect(result[0].duration).toBe(60);
        expect(result[0].continues).toBe(true);

        // Segment 2: Tue 00:00 - 01:30 (90 mins)
        expect(result[1].startTime).toBe('2024-02-13T00:00:00.000Z');
        expect(result[1].duration).toBe(90);
        expect(result[1].continues).toBe(false);
    });

    it('splits a multi-day task into multiple full-day segments', () => {
        // Mon 22:00 - Wed 02:00 UTC
        const start = '2024-02-12T22:00:00.000Z';
        const task = createTask('Multi Day', start, 1680);
        const result = splitTaskAcrossDays(task);

        expect(result).toHaveLength(3);

        // 1. Mon 22:00 - 24:00 (120m)
        expect(result[0].duration).toBe(120);
        expect(result[0].continues).toBe(true);
        expect(result[0].startTime).toBe(start);

        // 2. Tue 00:00 - 24:00 (1440m)
        expect(result[1].duration).toBe(1440);
        expect(result[1].continues).toBe(true);
        expect(result[1].startTime).toBe('2024-02-13T00:00:00.000Z');

        // 3. Wed 00:00 - 02:00 (120m)
        expect(result[2].duration).toBe(120);
        expect(result[2].continues).toBe(false);
        expect(result[2].startTime).toBe('2024-02-14T00:00:00.000Z');
    });
});
