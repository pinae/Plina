/** Parse a DRF DurationField string ("[D ]HH:MM:SS[.uuuuuu]") into minutes. */
export function parseDurationMinutes(value: string | null): number | null {
    if (!value) return null;
    const match = value.match(/^(?:(\d+) )?(\d{1,2}):(\d{2}):(\d{2})/);
    if (!match) return null;
    const [, days, hours, minutes] = match;
    return (days ? +days * 24 * 60 : 0) + +hours * 60 + +minutes;
}

/** "02:00:00" -> "2h", "1 02:00:00" -> "1d 2h", "01:30:00" -> "1h 30m". */
export function formatDuration(value: string | null): string {
    const total = parseDurationMinutes(value);
    if (total === null) return '—';
    const days = Math.floor(total / (24 * 60));
    const hours = Math.floor((total % (24 * 60)) / 60);
    const minutes = total % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    return parts.length ? parts.join(' ') : '0m';
}
