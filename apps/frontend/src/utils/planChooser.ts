/** WP-10: pure helpers for the plan chooser. */
import type { PlanAlternative } from '../types';

export type SlackSeverity = 'error' | 'warning' | 'success' | 'default';

/** Negative → over deadline (error); under a day → warning; else success. */
export function slackSeverity(seconds: number | null): SlackSeverity {
    if (seconds === null) return 'default';
    if (seconds < 0) return 'error';
    if (seconds < 24 * 3600) return 'warning';
    return 'success';
}

function humanize(totalSeconds: number): string {
    const totalMinutes = Math.round(totalSeconds / 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes && !days) parts.push(`${minutes}m`);
    return parts.length ? parts.join(' ') : '0m';
}

export function formatSlack(seconds: number | null): string {
    if (seconds === null) return 'no deadline pressure';
    if (seconds < 0) return `${humanize(-seconds)} over`;
    return `${humanize(seconds)} slack`;
}

export interface TimelineBlock {
    header: string;
    color: string;
    /** Seconds — flex weight for the strip. */
    weight: number;
}

export interface TimelineDay {
    dayLabel: string;
    blocks: TimelineBlock[];
}

const FALLBACK_COLOR = '#9e9e9e';

/** The first `maxDays` days of an alternative as proportional color strips. */
export function miniTimeline(
    alternative: PlanAlternative, maxDays = 3,
): TimelineDay[] {
    const items = [
        ...alternative.appointments,
        ...alternative.buckets.flatMap(bucket => bucket.items),
    ].sort((a, b) => a.start_time.localeCompare(b.start_time));

    const byDay = new Map<string, TimelineDay>();
    for (const item of items) {
        const date = new Date(item.start_time);
        const key = date.toDateString();
        if (!byDay.has(key)) {
            if (byDay.size >= maxDays) break;
            byDay.set(key, {
                dayLabel: date.toLocaleDateString(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric',
                }),
                blocks: [],
            });
        }
        byDay.get(key)!.blocks.push({
            header: item.header,
            color: item.hex_color ?? FALLBACK_COLOR,
            weight: item.duration,
        });
    }
    return [...byDay.values()];
}
