import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { apiBaseUrl } from './api.ts';
import { API, loggedInSession } from './testing/treeFixtures.ts';

describe('apiBaseUrl', () => {
    it.each([
        [undefined, 'http://localhost:8000/api/'],
        ['', 'http://localhost:8000/api/'],
        ['   ', 'http://localhost:8000/api/'],
        ['http://localhost:8001', 'http://localhost:8001/api/'],
        ['http://localhost:8001/', 'http://localhost:8001/api/'],
        [' https://plina.example.com// ', 'https://plina.example.com/api/'],
        ['https://example.com/plina', 'https://example.com/plina/api/'],
        // The Docker image: the API on the page's own origin (nginx proxies it).
        ['/', '/api/'],
        ['/plina', '/plina/api/'],
    ])('backend %j -> %s', (backendUrl, expected) => {
        expect(apiBaseUrl(backendUrl)).toBe(expected);
    });
});

describe('the API client', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('talks to the backend from VITE_BACKEND_URL', async () => {
        vi.stubEnv('VITE_BACKEND_URL', 'http://192.168.1.20:8001');
        vi.resetModules();
        const { default: api } = await import('./api.ts');
        expect(api.defaults.baseURL).toBe('http://192.168.1.20:8001/api/');
    });

    it('is pinned to the default backend in tests (the msw handlers use it)', async () => {
        const { default: api } = await import('./api.ts');
        expect(api.defaults.baseURL).toBe('http://localhost:8000/api/');
    });
});

describe('the session (README: Accounts)', () => {
    let posted: { csrf: string | null }[] = [];
    let sessionToken = 'token-a';
    let refuseCsrfOnce = false;
    const server = setupServer(
        http.get(`${API}/auth/session/`, () => HttpResponse.json(loggedInSession({ csrf_token: sessionToken }))),
        http.get(`${API}/tasks/`, () => HttpResponse.json([])),
        http.post(`${API}/tasks/`, ({ request }) => {
            const csrf = request.headers.get('X-CSRFToken');
            posted.push({ csrf });
            if (refuseCsrfOnce) {
                refuseCsrfOnce = false;
                return HttpResponse.json({ detail: 'CSRF Failed: CSRF token from the \'X-Csrftoken\' HTTP header incorrect.' }, { status: 403 });
            }
            return HttpResponse.json({ id: 'new' }, { status: 201 });
        }),
        http.get(`${API}/plan/`, () => HttpResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 })),
    );
    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => { server.resetHandlers(); posted = []; sessionToken = 'token-a'; refuseCsrfOnce = false; });
    afterAll(() => server.close());

    it('sends the cookie, and the CSRF token from the session with every change', async () => {
        const { default: api, fetchSession, createTask } = await import('./api.ts');
        expect(api.defaults.withCredentials).toBe(true);
        await fetchSession();
        await createTask({ header: 'x' });
        expect(posted).toEqual([{ csrf: 'token-a' }]);
    });

    it('fetches a fresh token and tries once more when the server refuses the old one', async () => {
        const { fetchSession, createTask } = await import('./api.ts');
        await fetchSession();
        sessionToken = 'token-b';  // e.g. a login in another tab rotated it
        refuseCsrfOnce = true;
        await createTask({ header: 'x' });
        expect(posted).toEqual([{ csrf: 'token-a' }, { csrf: 'token-b' }]);
    });

    it('tells its listeners when the server says nobody is logged in', async () => {
        const { fetchPlan, onUnauthorized } = await import('./api.ts');
        const listener = vi.fn();
        const stop = onUnauthorized(listener);
        await expect(fetchPlan()).rejects.toThrow();
        expect(listener).toHaveBeenCalledTimes(1);
        stop();
        await expect(fetchPlan()).rejects.toThrow();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('knows the URL of a backend page, e.g. the single sign-on', async () => {
        const { backendUrl } = await import('./api.ts');
        expect(backendUrl('/django/oidc/authenticate/')).toBe('http://localhost:8000/django/oidc/authenticate/');
    });
});
