/**
 * Sorting tracked time afterwards (docs/sort-time.md): the shares of a work
 * block, computed as the server does (services.work_blocks.shares) for the
 * sheet's live preview. The server's are the ones saved.
 */
import { formatDuration, minutesToDurationString, parseDurationMinutes } from './duration.ts';

/** A ticked row as far as its share goes. */
export interface ShareInput {
    /** Its estimate (the default duration without one). */
    estimateMinutes: number;
    /** Tracked on it outside this block. */
    spentElsewhereMinutes: number;
    /** Done (☑) — else worked on (◐), which weighs half. */
    completed: boolean;
    /** Typed by the user: this long, not scaled. */
    pinnedMinutes: number | null;
}

/** What is left of its estimate, at least a quarter of it; half for a task only worked on. */
export function weightMinutes(item: ShareInput): number {
    const left = Math.max(item.estimateMinutes - item.spentElsewhereMinutes, item.estimateMinutes / 4, 0);
    return item.completed ? left : left / 2;
}

const spoken = (seconds: number) => formatDuration(minutesToDurationString(seconds / 60));

/** Each row's share of ``totalSeconds``, in order: pinned ones as typed, the
 *  others by weight, scaled to fill what is left — whole minutes, the last
 *  one taking the seconds. With every row pinned, the rest stays untracked. */
export function shares(totalSeconds: number, items: ShareInput[]): { seconds: number[] } | { error: string } {
    const pinned = items.reduce((sum, item) => sum + (item.pinnedMinutes ?? 0) * 60, 0);
    if (pinned > totalSeconds) {
        return { error: `The minutes typed add up to ${spoken(pinned)}, more than the ${spoken(totalSeconds)} to share.` };
    }
    const seconds = items.map(item => (item.pinnedMinutes ?? 0) * 60);
    const free = items.flatMap((item, index) => (item.pinnedMinutes === null ? [index] : []));
    if (free.length === 0) return { seconds };
    const left = totalSeconds - pinned;
    let weights = free.map(index => weightMinutes(items[index]));
    let whole = weights.reduce((a, b) => a + b, 0);
    if (whole <= 0) {
        weights = free.map(() => 1);
        whole = free.length;
    }
    // Rounded where the shares meet, so the rounding does not add up.
    let reached = 0;
    let previous = 0;
    free.forEach((index, position) => {
        reached += weights[position];
        const boundary = position === free.length - 1 ? left : 60 * Math.round((left * reached) / whole / 60);
        seconds[index] = boundary - previous;
        previous = boundary;
    });
    return { seconds };
}

/** Shorter sessions are not worth asking about. */
const LONG_SESSION_MINUTES = 30;

/** A session that ran long — over 1.5× what was left of its task's estimate
 *  when it began (``task``: as the stop answered, its time included) — may
 *  have covered more tasks: the tracker asks "Only this task?". */
export function ranLong(session: { seconds: number }, task: { duration: string | null; time_spent: string },
                        defaultMinutes: number): boolean {
    const minutes = session.seconds / 60;
    const before = (parseDurationMinutes(task.time_spent) ?? 0) - minutes;
    const left = Math.max(0, (parseDurationMinutes(task.duration) ?? defaultMinutes) - before);
    return minutes >= LONG_SESSION_MINUTES && minutes > 1.5 * left;
}
