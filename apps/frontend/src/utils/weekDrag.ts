/**
 * Pure geometry for dragging Week-view items (tasks and buckets).
 *
 * All values are in minutes-since-midnight; the caller converts pixels <-> minutes
 * using the current zoom (columnHeight represents a full 1440-minute day).
 */

export type DragMode = 'move' | 'resize-top' | 'resize-bottom';

export interface DragResult {
    startMinutes: number;
    durationMinutes: number;
}

interface DragOptions {
    /** Snap grid in minutes. */
    step?: number;
    /** Smallest allowed duration in minutes. */
    minDuration?: number;
    /** Length of the day in minutes. */
    dayMinutes?: number;
}

/** Round a minute value to the nearest `step`. */
export function snapMinutes(minutes: number, step = 15): number {
    return Math.round(minutes / step) * step;
}

/** Convert a pixel delta into a minute delta for the current zoom. */
export function pixelsToMinutes(pixels: number, columnHeight: number): number {
    return (pixels / columnHeight) * 1440;
}

/** Convert a minute value into a pixel offset for the current zoom. */
export function minutesToPixels(minutes: number, columnHeight: number): number {
    return (minutes / 1440) * columnHeight;
}

/**
 * Apply a drag of `deltaMinutes` to an item, clamped to the day and snapped.
 *
 * - `move` shifts the start, keeping the duration (and the item inside the day).
 * - `resize-bottom` changes the end (duration), start fixed.
 * - `resize-top` changes the start and duration, end fixed.
 */
export function applyDrag(
    mode: DragMode,
    startMinutes: number,
    durationMinutes: number,
    deltaMinutes: number,
    { step = 15, minDuration = 15, dayMinutes = 1440 }: DragOptions = {},
): DragResult {
    const endMinutes = startMinutes + durationMinutes;

    if (mode === 'move') {
        let start = snapMinutes(startMinutes + deltaMinutes, step);
        start = Math.max(0, Math.min(start, dayMinutes - durationMinutes));
        return { startMinutes: start, durationMinutes };
    }

    if (mode === 'resize-bottom') {
        let end = snapMinutes(endMinutes + deltaMinutes, step);
        end = Math.min(dayMinutes, Math.max(end, startMinutes + minDuration));
        return { startMinutes, durationMinutes: end - startMinutes };
    }

    // resize-top
    let start = snapMinutes(startMinutes + deltaMinutes, step);
    start = Math.max(0, Math.min(start, endMinutes - minDuration));
    return { startMinutes: start, durationMinutes: endMinutes - start };
}
