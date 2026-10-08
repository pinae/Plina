import type { ViewTask } from '../components/WeekViewTask/WeekViewTask.tsx';

/** A card over midnight becomes one per day. The Week view's days are the
 *  device's days, so it is split at local midnight (not UTC's: in Berlin a
 *  task from 23:00 to 01:00 would otherwise hang out of the bottom of its
 *  day, and one from 01:00 to 03:00 be cut in two at 02:00). */
export const splitTaskAcrossDays = (task: ViewTask): ViewTask[] => {
    const segments: ViewTask[] = [];
    let currentStart = new Date(task.startTime);
    let remaining = task.duration; // minutes, maybe with fractions (seconds)

    while (remaining > 1e-6) {
        const midnight = new Date(currentStart);
        midnight.setHours(24, 0, 0, 0); // the next local midnight
        const untilMidnight = (midnight.getTime() - currentStart.getTime()) / 60000;
        if (untilMidnight <= 0) break; // safety
        const fits = remaining <= untilMidnight;
        const length = fits ? remaining : untilMidnight;
        segments.push({
            ...task,
            startTime: currentStart.toISOString(),
            duration: length,
            // Continues on the next day, or (last one) as the task said.
            continues: fits ? task.continues : true,
        });
        remaining -= length;
        currentStart = midnight;
    }
    return segments;
};
