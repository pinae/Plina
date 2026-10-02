import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiBaseUrl } from './api.ts';

describe('apiBaseUrl', () => {
    it.each([
        [undefined, 'http://localhost:8000/api/'],
        ['', 'http://localhost:8000/api/'],
        ['   ', 'http://localhost:8000/api/'],
        ['http://localhost:8001', 'http://localhost:8001/api/'],
        ['http://localhost:8001/', 'http://localhost:8001/api/'],
        [' https://plina.example.com// ', 'https://plina.example.com/api/'],
        ['https://example.com/plina', 'https://example.com/plina/api/'],
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
