/**
 * The calendars Plina reads (README: Calendar): adding one by its secret
 * address (never shown again), reading them now, removing one.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { CalendarSettings } from './CalendarSettings.tsx';
import { API, loggedInSession } from '../../testing/treeFixtures.ts';
import type { CalendarSubscription } from '../../types.ts';

const google: CalendarSubscription = {
    id: 'cal-1', name: 'Google Calendar', url_hint: 'calendar.google.com …', email: 'pina@example.com',
    hex_color: '#7986cb', last_synced_at: '2026-10-06T08:15:00Z', last_error: '',
};

let calendars: CalendarSubscription[] = [];
let log: string[] = [];
let created: Record<string, unknown>[] = [];

const server = setupServer(
    http.get(`${API}/auth/session/`, () => HttpResponse.json(loggedInSession())),
    http.get(`${API}/calendars/`, () => HttpResponse.json(calendars)),
    http.post(`${API}/calendars/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        created.push(body);
        if (body.url === 'http://localhost/secret.ics') {
            return HttpResponse.json({ url: ['Plina reads calendars over https only.'] }, { status: 400 });
        }
        calendars = [{ ...google, name: String(body.name) }];
        return HttpResponse.json(calendars[0], { status: 201 });
    }),
    http.post(`${API}/calendars/sync/`, async ({ request }) => {
        log.push(`sync ${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ changed: true, calendars });
    }),
    http.delete(`${API}/calendars/:id/`, ({ params }) => {
        log.push(`delete ${params.id}`);
        calendars = [];
        return new HttpResponse(null, { status: 204 });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    calendars = [];
    log = [];
    created = [];
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

describe('CalendarSettings', () => {
    it('adds a calendar by its secret address, with your address from the session', async () => {
        render(<CalendarSettings />, { wrapper });
        fireEvent.click(await screen.findByRole('button', { name: 'Add a calendar' }));

        expect(input(/^Name/).value).toBe('Google Calendar');
        await waitFor(() => expect(input(/Your address/).value).toBe('pina@example.com'));
        // A secret: not shown while typed.
        expect(input(/Secret address/)).toHaveAttribute('type', 'password');

        fireEvent.change(input(/Secret address/), { target: { value: 'http://localhost/secret.ics' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add and read' }));
        expect(await screen.findByText('Plina reads calendars over https only.')).toBeInTheDocument();

        fireEvent.change(input(/Secret address/), {
            target: { value: ' https://calendar.google.com/calendar/ical/x/private-abc/basic.ics ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add and read' }));

        await waitFor(() => expect(created).toHaveLength(2));
        expect(created[1]).toEqual({
            name: 'Google Calendar', email: 'pina@example.com',
            url: 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics',
        });
        // The list shows where it is read from, never the secret address.
        expect(await screen.findByText(/calendar\.google\.com …/)).toBeInTheDocument();
        expect(screen.queryByText(/private-abc/)).toBeNull();
    });

    it('shows when a calendar was read and why it could not be', async () => {
        calendars = [google, { ...google, id: 'cal-2', name: 'Work', last_error: 'The calendar answered 404.' }];
        render(<CalendarSettings />, { wrapper });

        expect(await screen.findByText('Work')).toBeInTheDocument();
        expect(screen.getByText('The calendar answered 404.')).toBeInTheDocument();
        expect(screen.getByText(/calendar\.google\.com … · read /)).toBeInTheDocument();
    });

    it('reads all calendars now', async () => {
        calendars = [google];
        render(<CalendarSettings />, { wrapper });

        fireEvent.click(await screen.findByRole('button', { name: 'Read now' }));

        await waitFor(() => expect(log).toEqual(['sync {"force":true}']));
    });

    it('removes a calendar after asking', async () => {
        calendars = [google];
        render(<CalendarSettings />, { wrapper });

        fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('Remove “Google Calendar”?');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(log).toEqual(['delete cal-1']));
        await waitFor(() => expect(screen.queryByText('Google Calendar')).toBeNull());
    });
});
