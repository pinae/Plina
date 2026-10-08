import { describe, expect, it } from 'vitest';
import { overlapLanes } from './overlapLanes.ts';

const at = (hour: number, minutes: number) => ({ startTime: new Date(2026, 9, 8, hour).toISOString(), duration: minutes });

describe('overlapLanes', () => {
    it('leaves cards that do not overlap the whole width', () => {
        expect(overlapLanes([at(9, 60), at(10, 60), at(12, 30)])).toEqual([
            { index: 0, count: 1 }, { index: 0, count: 1 }, { index: 0, count: 1 },
        ]);
    });

    it('puts overlapping cards side by side, the longer one first', () => {
        // Your appointment 14–15, the invitation 14–15:30.
        expect(overlapLanes([at(14, 60), at(14, 90)])).toEqual([{ index: 1, count: 2 }, { index: 0, count: 2 }]);
    });

    it('reuses a lane once it is free and counts the lanes of the whole group', () => {
        // 9–11 and 10–10:30 overlap; 10:30–12 follows 10–10:30 in its lane; 13–14 is alone.
        const lanes = overlapLanes([at(9, 120), { ...at(10, 30) }, { startTime: new Date(2026, 9, 8, 10, 30).toISOString(), duration: 90 }, at(13, 60)]);
        expect(lanes).toEqual([
            { index: 0, count: 2 }, { index: 1, count: 2 }, { index: 1, count: 2 }, { index: 0, count: 1 },
        ]);
    });

    it('counts an overlap of seconds as touching', () => {
        // Tracked live until 10:15:37, the next one typed in from 10:15.
        const first = { startTime: new Date(2026, 9, 8, 9).toISOString(), duration: 75 + 37 / 60 };
        const second = { startTime: new Date(2026, 9, 8, 10, 15).toISOString(), duration: 45 };
        expect(overlapLanes([first, second])).toEqual([{ index: 0, count: 1 }, { index: 0, count: 1 }]);
    });
});
