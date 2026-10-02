import { describe, expect, it } from 'vitest';

import { LABEL_STEPS, MIN_LABEL_GAP_PX, labelStepMinutes, timeScaleLabels } from './timeScale.ts';

const heightFor = (pxPerHour: number) => pxPerHour * 24;

describe('labelStepMinutes', () => {
    it.each([
        // px per hour measured in the app (fit-to-viewport, zoom 1) and zoomed in
        ['very slim window (6.5 px/h)', 6.5, 240],
        ['low resolution (15.6 px/h)', 15.6, 120],
        ['phone (20.5 px/h)', 20.5, 120],
        ['1440×900 (26.5 px/h)', 26.5, 60],
        ['big screen (34 px/h)', 34, 60],
        ['zoomed in (53 px/h)', 53, 30],
        ['maximum zoom (204 px/h)', 204, 30],
        ['tiny column (1.5 px/h)', 1.5, 720],
    ])('%s -> every %i min', (_label, pxPerHour, step) => {
        expect(labelStepMinutes(heightFor(pxPerHour))).toBe(step);
    });
});

describe('timeScaleLabels', () => {
    it('labels every step except midnight (the top edge), as HH:MM', () => {
        const labels = timeScaleLabels(heightFor(6.5));
        expect(labels.map(l => l.text)).toEqual(['04:00', '08:00', '12:00', '16:00', '20:00']);
        expect(labels.map(l => l.minutes)).toEqual([240, 480, 720, 960, 1200]);
    });

    it('marks the full hours (half hours are secondary)', () => {
        const labels = timeScaleLabels(heightFor(53));
        expect(labels[0]).toMatchObject({ text: '00:30', fullHour: false });
        expect(labels[1]).toMatchObject({ text: '01:00', fullHour: true });
        expect(labels).toHaveLength(47);
    });

    it('never puts two labels closer than the minimum gap, and adds as many as fit', () => {
        for (let height = 30; height <= 6000; height += 7) {
            const step = labelStepMinutes(height);
            const gap = (step / 1440) * height;
            const finer = LABEL_STEPS[LABEL_STEPS.indexOf(step) - 1];
            if (step !== LABEL_STEPS[LABEL_STEPS.length - 1]) {
                expect(gap, `height ${height}`).toBeGreaterThanOrEqual(MIN_LABEL_GAP_PX);
            }
            if (finer !== undefined) {
                expect((finer / 1440) * height, `height ${height}`).toBeLessThan(MIN_LABEL_GAP_PX);
            }
        }
    });
});
