import { describe, it, expect } from 'vitest';
import { applyDrag, minutesToPixels, pixelsToMinutes, snapMinutes } from './weekDrag.ts';

describe('snapMinutes', () => {
    it('rounds to the nearest 15 by default', () => {
        expect(snapMinutes(7)).toBe(0);
        expect(snapMinutes(8)).toBe(15);
        expect(snapMinutes(610)).toBe(615);
    });
});

describe('pixel/minute conversions', () => {
    it('round-trips against a 1440px column (1px = 1min)', () => {
        expect(pixelsToMinutes(600, 1440)).toBe(600);
        expect(minutesToPixels(600, 1440)).toBe(600);
    });
    it('scales with zoom', () => {
        // 2880px column -> 2px per minute.
        expect(pixelsToMinutes(120, 2880)).toBe(60);
        expect(minutesToPixels(60, 2880)).toBe(120);
    });
});

describe('applyDrag', () => {
    it('moves the start and keeps the duration, snapping to 15', () => {
        const r = applyDrag('move', 540, 60, 20); // 09:00 +20min
        expect(r).toEqual({ startMinutes: 555, durationMinutes: 60 });
    });

    it('clamps a move so the item stays inside the day', () => {
        const r = applyDrag('move', 1380, 60, 120); // 23:00, would overflow
        expect(r).toEqual({ startMinutes: 1380, durationMinutes: 60 });
    });

    it('does not move before midnight', () => {
        const r = applyDrag('move', 30, 60, -120);
        expect(r).toEqual({ startMinutes: 0, durationMinutes: 60 });
    });

    it('resize-bottom changes duration only', () => {
        const r = applyDrag('resize-bottom', 540, 60, 60); // extend by 1h
        expect(r).toEqual({ startMinutes: 540, durationMinutes: 120 });
    });

    it('resize-bottom enforces the minimum duration', () => {
        const r = applyDrag('resize-bottom', 540, 60, -120);
        expect(r).toEqual({ startMinutes: 540, durationMinutes: 15 });
    });

    it('resize-top moves start and keeps the end fixed', () => {
        const r = applyDrag('resize-top', 540, 120, -60); // start 08:00, end stays 11:00
        expect(r).toEqual({ startMinutes: 480, durationMinutes: 180 });
    });

    it('resize-top cannot cross the end (min duration)', () => {
        const r = applyDrag('resize-top', 540, 60, 120);
        expect(r).toEqual({ startMinutes: 585, durationMinutes: 15 });
    });
});
