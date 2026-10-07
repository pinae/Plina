/** Entering tracked time (README: Time sheet): a day, from and until. */
import type { AxiosError } from 'axios';

import { addDays } from './dateInput.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** A moment -> the value of an <input type="time"> ("08:05", local time). */
export const toTimeInput = (value: Date | string): string => {
    const date = new Date(value);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** An until at or before the from is on the next day (work into the night). */
export const untilNextDay = (from: string, until: string) => Boolean(from && until && until <= from);

/** "2026-10-07", "22:00", "01:30" -> 22:00 that day until 01:30 the next; an
 *  empty until: no end (the time being tracked right now). */
export function composeSpan(date: string, from: string, until: string): { start: Date; end: Date | null } {
    const start = new Date(`${date}T${from}`);
    if (!until) return { start, end: null };
    const end = new Date(`${date}T${until}`);
    return { start, end: untilNextDay(from, until) ? addDays(end, 1) : end };
}

/** ``moment`` as sent: the ``original`` with its seconds when the minute
 *  shown was not changed — only a changed time is a whole minute. */
export function keepSeconds(moment: Date, original: string | null): string {
    if (original) {
        const minute = new Date(original);
        minute.setSeconds(0, 0);
        if (minute.getTime() === moment.getTime()) return original;
    }
    return moment.toISOString();
}

/** Why the server refused (its words), else ``fallback``. */
export function refusal(failure: Error, fallback: string): string {
    const data = (failure as AxiosError<Record<string, unknown>>).response?.data;
    if (!data || typeof data !== 'object') return fallback;
    const first = data.detail ?? Object.values(data)[0];
    return Array.isArray(first) ? String(first[0]) : first ? String(first) : fallback;
}
