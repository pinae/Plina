import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useTimeZoneSync } from './useTimeZoneSync.ts';
import { API } from '../testing/treeFixtures.ts';
import type { SettingsWrite, UserSettings } from '../types.ts';

let stored: UserSettings;
let patches: SettingsWrite[] = [];
const server = setupServer(
    http.get(`${API}/settings/`, () => HttpResponse.json(stored)),
    http.patch(`${API}/settings/`, async ({ request }) => {
        const body = await request.json() as SettingsWrite;
        patches.push(body);
        stored = { ...stored, ...body } as UserSettings;
        return HttpResponse.json(stored);
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); patches = []; });
afterAll(() => server.close());

const settings = (time_zone: string): UserSettings => ({
    default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone,
});
function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useTimeZoneSync', () => {
    it('tells the server the device time zone, so "at 14:00" means 14:00 here', async () => {
        stored = settings('');
        renderHook(() => useTimeZoneSync('Europe/Berlin'), { wrapper });
        await waitFor(() => expect(patches).toEqual([{ time_zone: 'Europe/Berlin' }]));
    });

    it('follows the device when it moves to another zone', async () => {
        stored = settings('Europe/Berlin');
        renderHook(() => useTimeZoneSync('America/New_York'), { wrapper });
        await waitFor(() => expect(patches).toEqual([{ time_zone: 'America/New_York' }]));
    });

    it('sends nothing when the server already has it', async () => {
        stored = settings('Europe/Berlin');
        const { result } = renderHook(() => useTimeZoneSync('Europe/Berlin'), { wrapper });
        await waitFor(() => expect(result.current).toBe('Europe/Berlin'));
        expect(patches).toEqual([]);
    });

    it('uses the browser zone by default', async () => {
        stored = settings(Intl.DateTimeFormat().resolvedOptions().timeZone);
        const { result } = renderHook(() => useTimeZoneSync(), { wrapper });
        await waitFor(() => expect(result.current).toBe(stored.time_zone));
        expect(patches).toEqual([]);
    });
});
