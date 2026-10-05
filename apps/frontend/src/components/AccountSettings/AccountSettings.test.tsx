/** The settings' account section (README: Accounts): who is logged in,
 *  logging out, and a new password for a Plina account. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSettings } from './AccountSettings.tsx';
import { goTo } from '../../utils/navigation.ts';
import { API, loggedInSession, loggedOutSession } from '../../testing/treeFixtures.ts';
import type { Session } from '../../types.ts';

vi.mock('../../utils/navigation.ts', () => ({ goTo: vi.fn() }));

let session: Session;
let logoutRedirect: string | null = null;
let requests: string[] = [];
const server = setupServer(
    http.get(`${API}/auth/session/`, () => { requests.push('GET session'); return HttpResponse.json(session); }),
    http.post(`${API}/auth/logout/`, ({ request }) => {
        requests.push(`POST logout ${request.headers.get('X-CSRFToken')}`);
        session = loggedOutSession();
        return HttpResponse.json({ redirect: logoutRedirect });
    }),
    http.post(`${API}/auth/password/`, async ({ request }) => {
        const body = await request.json() as { old_password: string; new_password: string };
        requests.push(`POST password ${body.old_password} ${body.new_password}`);
        if (body.old_password !== 'old secret') {
            return HttpResponse.json({ old_password: ['That is not your current password.'] }, { status: 400 });
        }
        if (body.new_password.length < 8) {
            return HttpResponse.json({ new_password: ['This password is too short.'] }, { status: 400 });
        }
        return HttpResponse.json(session);
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => { session = loggedInSession(); logoutRedirect = null; requests = []; });
afterEach(() => { cleanup(); server.resetHandlers(); vi.clearAllMocks(); });
afterAll(() => server.close());

const renderAccount = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountSettings />
    </QueryClientProvider>,
);

describe('AccountSettings', () => {
    it('says who is logged in', async () => {
        renderAccount();
        expect(await screen.findByText(/logged in as/i)).toHaveTextContent('Logged in as Pina Merkert (pina)');
    });

    it('logs out with the CSRF token, then asks for the session again', async () => {
        renderAccount();
        fireEvent.click(await screen.findByRole('button', { name: /log out/i }));
        await waitFor(() => expect(requests).toEqual(['GET session', 'POST logout token-1', 'GET session']));
        expect(goTo).not.toHaveBeenCalled();
    });

    it('after the single sign-on, logs out at the provider too', async () => {
        session = loggedInSession({
            user: { ...loggedInSession().user!, single_sign_on: true, can_change_password: false },
            single_sign_on: { name: 'Digisoul', login_url: '/django/oidc/authenticate/' },
        });
        logoutRedirect = 'https://auth.example.com/end-session/?id_token_hint=abc';
        renderAccount();
        expect(await screen.findByText(/logged in as/i)).toHaveTextContent('with Digisoul');
        expect(screen.queryByRole('button', { name: /change password/i })).toBeNull(); // the provider's job
        fireEvent.click(screen.getByRole('button', { name: /log out/i }));
        await waitFor(() => expect(goTo).toHaveBeenCalledWith(logoutRedirect));
    });

    it('changes the password', async () => {
        renderAccount();
        fireEvent.click(await screen.findByRole('button', { name: /change password/i }));
        const save = () => screen.getByRole('button', { name: /save password/i });
        fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old secret' } });
        fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'a new passphrase' } });
        fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'a new passphrasf' } });
        expect(screen.getByText(/the new passwords differ/i)).toBeInTheDocument();
        expect(save()).toBeDisabled();
        fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'a new passphrase' } });
        fireEvent.click(save());
        expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
        expect(requests).toContain('POST password old secret a new passphrase');
        expect(screen.queryByLabelText(/current password/i)).toBeNull();
    });

    it('cancelling changes nothing', async () => {
        renderAccount();
        fireEvent.click(await screen.findByRole('button', { name: /change password/i }));
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(screen.queryByLabelText(/current password/i)).toBeNull();
        expect(screen.queryByText(/password changed/i)).toBeNull();
    });

    it('shows why a password was refused', async () => {
        renderAccount();
        fireEvent.click(await screen.findByRole('button', { name: /change password/i }));
        fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'wrong' } });
        fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'short' } });
        fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'short' } });
        fireEvent.click(screen.getByRole('button', { name: /save password/i }));
        expect(await screen.findByText('That is not your current password.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old secret' } });
        fireEvent.click(screen.getByRole('button', { name: /save password/i }));
        expect(await screen.findByText('This password is too short.')).toBeInTheDocument();
    });
});
