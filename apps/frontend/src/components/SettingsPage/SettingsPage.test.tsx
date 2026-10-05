import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SettingsPage } from './SettingsPage.tsx';
import { API, loggedInSession } from '../../testing/treeFixtures.ts';

let patches: unknown[] = [];
const server = setupServer(
    http.get(`${API}/auth/session/`, () => HttpResponse.json(loggedInSession())),
    http.get(`${API}/settings/`, () => HttpResponse.json({
        default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
    })),
    http.patch(`${API}/settings/`, async ({ request }) => {
        const body = await request.json() as { default_duration: string };
        patches.push(body);
        return HttpResponse.json({ default_duration: body.default_duration, active_task_id: null, active_task_path: [], time_zone: '' });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { cleanup(); server.resetHandlers(); patches = []; });
afterAll(() => server.close());

const renderPage = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SettingsPage />
    </QueryClientProvider>,
);
const field = () => screen.getByRole('textbox', { name: /default duration/i });

describe('SettingsPage', () => {
    it('shows the current default duration', async () => {
        renderPage();
        await waitFor(() => expect(field()).toHaveValue('1h'));
    });

    it('saves a new default duration', async () => {
        renderPage();
        await waitFor(() => expect(field()).toHaveValue('1h'));
        fireEvent.change(field(), { target: { value: '30m' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(patches).toEqual([{ default_duration: '00:30:00' }]));
        expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    });

    it('explains an unreadable or zero duration and sends nothing', async () => {
        renderPage();
        await waitFor(() => expect(field()).toHaveValue('1h'));
        fireEvent.change(field(), { target: { value: 'soon' } });
        expect(screen.getByText(/“soon” is not a duration/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
        fireEvent.change(field(), { target: { value: '0' } });
        expect(screen.getByText(/longer than 0 minutes/)).toBeInTheDocument();
        expect(patches).toEqual([]);
    });

    it('shows the server’s message when the value is refused', async () => {
        server.use(http.patch(`${API}/settings/`, () => HttpResponse.json(
            { default_duration: ['The default duration can be at most 1000 hours.'] }, { status: 400 })));
        renderPage();
        await waitFor(() => expect(field()).toHaveValue('1h'));
        fireEvent.change(field(), { target: { value: '999h' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(await screen.findByText(/at most 1000 hours/)).toBeInTheDocument();
    });
});

describe('SettingsPage — the Week view\'s time frame', () => {
    const from = () => screen.getByLabelText(/^from$/i);
    const to = () => screen.getByLabelText(/^to$/i);
    const saveFrame = () => fireEvent.click(screen.getByRole('button', { name: /save time frame/i }));
    const serveSettings = (start = '08:00:00', end = '16:45:00') => server.use(
        http.get(`${API}/settings/`, () => HttpResponse.json({
            default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
            week_view_start: start, week_view_end: end,
        })),
        http.patch(`${API}/settings/`, async ({ request }) => {
            const body = await request.json() as Record<string, string>;
            patches.push(body);
            return HttpResponse.json({ default_duration: '01:00:00', active_task_id: null, active_task_path: [],
                time_zone: '', week_view_start: start, week_view_end: end, ...body });
        }),
    );

    it('shows the usual work hours, 08:00 to 16:45 by default', async () => {
        serveSettings();
        renderPage();
        await waitFor(() => expect(from()).toHaveValue('08:00'));
        expect(to()).toHaveValue('16:45');
        expect(screen.getByText(/week view opens/i)).toBeInTheDocument();
    });

    it('saves a new time frame', async () => {
        serveSettings();
        renderPage();
        await waitFor(() => expect(from()).toHaveValue('08:00'));
        fireEvent.change(from(), { target: { value: '07:30' } });
        fireEvent.change(to(), { target: { value: '18:00' } });
        saveFrame();
        await waitFor(() => expect(patches).toEqual([{ week_view_start: '07:30', week_view_end: '18:00' }]));
        expect(await screen.findByText(/saved — the week view opens on 07:30–18:00/i)).toBeInTheDocument();
    });

    it('refuses an end before the start', async () => {
        serveSettings();
        renderPage();
        await waitFor(() => expect(from()).toHaveValue('08:00'));
        fireEvent.change(to(), { target: { value: '07:00' } });
        expect(screen.getByText(/the end must be after the start/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save time frame/i })).toBeDisabled();
        expect(patches).toEqual([]);
    });
});
