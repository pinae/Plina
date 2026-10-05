/**
 * The app only opens for a logged-in user (README: Accounts): logged out it
 * shows the login page — a Plina account, or the single sign-on.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthGate } from './AuthGate.tsx';
import { fetchTasks } from '../../api.ts';
import { API, loggedInSession, loggedOutSession } from '../../testing/treeFixtures.ts';
import type { Session } from '../../types.ts';

let session: Session;
let logins: { body: unknown; csrf: string | null }[] = [];
const server = setupServer(
    http.get(`${API}/auth/session/`, () => HttpResponse.json(session)),
    http.post(`${API}/auth/login/`, async ({ request }) => {
        const body = await request.json() as { username: string; password: string };
        logins.push({ body, csrf: request.headers.get('X-CSRFToken') });
        if (body.password !== 'correct horse') return HttpResponse.json({ detail: 'Wrong user name or password.' }, { status: 400 });
        session = loggedInSession({ csrf_token: 'token-after-login' });
        return HttpResponse.json(session);
    }),
    http.get(`${API}/tasks/`, () => (session.authenticated
        ? HttpResponse.json([])
        : HttpResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 }))),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => { session = loggedOutSession(); logins = []; window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

function TheApp() {
    const tasks = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks });
    return <div>The app ({tasks.isSuccess ? 'tasks loaded' : 'loading tasks'})</div>;
}

const renderGate = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthGate><TheApp /></AuthGate>
    </QueryClientProvider>,
);

describe('AuthGate', () => {
    it('shows the login page, not the app, when nobody is logged in', async () => {
        renderGate();
        expect(await screen.findByRole('heading', { name: /log in to plina/i })).toBeInTheDocument();
        expect(screen.queryByText(/the app/i)).toBeNull();
        expect(screen.queryByRole('link', { name: /log in with/i })).toBeNull(); // no single sign-on configured
        expect(screen.queryByRole('link', { name: /forgot/i })).toBeNull(); // no mail configured
    });

    it('opens the app after logging in with a Plina account', async () => {
        renderGate();
        fireEvent.change(await screen.findByLabelText(/user name/i), { target: { value: 'pina' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'correct horse' } });
        fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));
        expect(await screen.findByText('The app (tasks loaded)')).toBeInTheDocument();
        expect(logins).toEqual([{ body: { username: 'pina', password: 'correct horse' }, csrf: 'token-0' }]);
    });

    it('says when the user name or password is wrong', async () => {
        renderGate();
        fireEvent.change(await screen.findByLabelText(/user name/i), { target: { value: 'pina' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'nope' } });
        fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));
        expect(await screen.findByText('Wrong user name or password.')).toBeInTheDocument();
        expect(screen.getByLabelText(/^password/i)).toHaveValue('');
    });

    it('offers the single sign-on, coming back to the same page', async () => {
        window.history.replaceState(null, '', '/week?x=1');
        session = loggedOutSession({ single_sign_on: { name: 'Digisoul', login_url: '/django/oidc/authenticate/' } });
        renderGate();
        const link = await screen.findByRole('link', { name: 'Log in with Digisoul' });
        expect(link).toHaveAttribute('href', 'http://localhost:8000/django/oidc/authenticate/?next='
            + encodeURIComponent('http://localhost:3000/week?x=1'));
        expect(screen.getByLabelText(/user name/i)).toBeInTheDocument(); // local accounts work too
    });

    it('links the password reset when the server can send mail', async () => {
        session = loggedOutSession({ password_reset_url: '/django/accounts/password_reset/' });
        renderGate();
        expect(await screen.findByRole('link', { name: /forgot your password/i }))
            .toHaveAttribute('href', 'http://localhost:8000/django/accounts/password_reset/');
    });

    it('says when the single sign-on failed, once', async () => {
        window.history.replaceState(null, '', '/?login=failed');
        session = loggedOutSession({ single_sign_on: { name: 'Digisoul', login_url: '/django/oidc/authenticate/' } });
        renderGate();
        expect(await screen.findByText(/the single sign-on did not work/i)).toBeInTheDocument();
        expect(window.location.search).toBe('');
    });

    it('goes back to the login page when the session ends', async () => {
        session = loggedInSession();
        renderGate();
        expect(await screen.findByText('The app (tasks loaded)')).toBeInTheDocument();
        session = loggedOutSession(); // e.g. expired, or logged out in another tab
        cleanup();
        renderGate();
        await waitFor(() => expect(screen.getByRole('heading', { name: /log in to plina/i })).toBeInTheDocument());
    });

    it('a 401 from any request shows the login page', async () => {
        session = loggedInSession();
        server.use(http.get(`${API}/tasks/`, () => {
            session = loggedOutSession();
            return HttpResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
        }));
        renderGate();
        expect(await screen.findByRole('heading', { name: /log in to plina/i })).toBeInTheDocument();
    });

    it('says when the server cannot be reached, with a retry', async () => {
        server.use(http.get(`${API}/auth/session/`, () => HttpResponse.error()));
        renderGate();
        // After one retry (a second later).
        expect(await screen.findByText(/cannot reach plina's server/i, {}, { timeout: 3000 })).toBeInTheDocument();
        server.resetHandlers();
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(await screen.findByRole('heading', { name: /log in to plina/i })).toBeInTheDocument();
    });
});
