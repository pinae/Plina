/**
 * What an "unplanned within the horizon" warning says (README: Task
 * Dependencies and Alternative Plans): without a deadline it is about the
 * time buckets of the next 60 days — how much of the task finds no place
 * there, and why.
 */
import type { PlanWarning } from '../types.ts';
import { formatDuration, minutesToDurationString } from './duration.ts';

/** "3h of it find no place in the time buckets of the next 60 days: they are full" */
export function whyUnplanned(warning: PlanWarning): string {
    if (warning.missing_minutes === undefined) return "doesn't fit into the time buckets of the next 60 days";
    const amount = formatDuration(minutesToDurationString(warning.missing_minutes));
    const reason = warning.waits_for
        ? `it waits for “${warning.waits_for}”, which doesn't fit either`
        : warning.only_tags?.length
            ? `it goes only into the buckets tagged ${warning.only_tags.map(tag => `#${tag}`).join(' or ')}`
            : 'they are full';
    return `${amount} of it find no place in the time buckets of the next 60 days: ${reason}`;
}
