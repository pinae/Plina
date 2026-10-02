/**
 * Labels of the Week view's time scale.  A day spans the whole column height
 * (fit-to-viewport times zoom), so how many labels fit depends on that height:
 * every 4th hour on very slim columns, every 2nd on low-resolution screens,
 * every hour on big ones and every half hour when zoomed in.
 */

/** Label steps in minutes, finest first; 6h and 12h only for tiny columns. */
export const LABEL_STEPS = [30, 60, 120, 240, 360, 720];

/** Labels are at least this far apart (about twice their height), so they
 *  never overlap and stay easy to read. */
export const MIN_LABEL_GAP_PX = 24;

/** The finest step whose labels keep the minimum gap on a column this tall. */
export function labelStepMinutes(columnHeight: number): number {
    const pxPerMinute = columnHeight / 1440;
    return LABEL_STEPS.find(step => step * pxPerMinute >= MIN_LABEL_GAP_PX)
        ?? LABEL_STEPS[LABEL_STEPS.length - 1];
}

export interface TimeLabel {
    minutes: number;
    text: string;
    fullHour: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The labelled times of a day column; midnight is its top edge and gets none. */
export function timeScaleLabels(columnHeight: number): TimeLabel[] {
    const step = labelStepMinutes(columnHeight);
    const labels: TimeLabel[] = [];
    for (let minutes = step; minutes < 1440; minutes += step) {
        labels.push({
            minutes,
            text: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
            fullHour: minutes % 60 === 0,
        });
    }
    return labels;
}
