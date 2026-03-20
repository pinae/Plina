import type { ViewTask } from '../components/WeekViewTask';

export const splitTaskAcrossDays = (task: ViewTask): ViewTask[] => {
    const segments: ViewTask[] = [];

    // Use UTC consistently
    let currentStart = new Date(task.startTime);
    let remainingDuration = task.duration; // in minutes

    while (remainingDuration > 0) {
        // Calculate end of the current day (UTC)
        const endOfDay = new Date(currentStart);
        endOfDay.setUTCHours(24, 0, 0, 0); // Jump to next day 00:00 UTC

        // Calculate duration until end of day (UTC)
        const diffMs = endOfDay.getTime() - currentStart.getTime();
        const minsUntilMidnight = Math.round(diffMs / (1000 * 60));

        if (minsUntilMidnight <= 0) {
            // Should not happen if logic is correct, but safety break
            break;
        }

        let segmentDuration = 0;
        let continues = false;

        if (remainingDuration <= minsUntilMidnight) {
            // Fits in current day
            segmentDuration = remainingDuration;
            remainingDuration = 0;
            // Respect original 'continues' if this is the last segment
            if (task.continues) continues = true;
        } else {
            // Spans over midnight
            segmentDuration = minsUntilMidnight;
            remainingDuration -= minsUntilMidnight;
            continues = true;
        }

        segments.push({
            ...task,
            startTime: currentStart.toISOString(),
            duration: segmentDuration,
            continues: continues,
        });

        // Setup next iteration
        currentStart = new Date(endOfDay); // Start next segment at 00:00 UTC
    }

    return segments;
};
