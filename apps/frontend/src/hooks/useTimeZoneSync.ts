/**
 * Keeps ``UserSettings.time_zone`` on the device's zone. The server reads
 * recurrence rules ("every day at 14:00") in that zone — without it, the
 * server's own zone (UTC) moved the buckets, e.g. to 16:00 in Berlin.
 * Returns the zone the server knows (undefined while loading).
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys, useSettings, useUpdateSettings } from '../queries.tsx';

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function useTimeZoneSync(zone: string = deviceZone()): string | undefined {
    const settings = useSettings();
    const update = useUpdateSettings();
    const client = useQueryClient();
    const sent = useRef<string | null>(null);
    const serverZone = settings.data?.time_zone;
    const { mutate } = update;

    useEffect(() => {
        if (serverZone === undefined || !zone || serverZone === zone || sent.current === zone) return;
        sent.current = zone;
        // The server re-plans with the buckets at their new times.
        mutate({ time_zone: zone }, { onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.plan }) });
    }, [serverZone, zone, mutate, client]);

    return serverZone;
}
