/** Test servers (msw) for the filter bar (README: Filtering tasks): saved
 *  filters kept in ``store``, with the backend's name check. */
import { http, HttpResponse } from 'msw';

import type { SavedFilter, SavedFilterWrite } from '../types.ts';
import { normalizeFilter } from '../utils/taskFilter.ts';

export const savedFilterHandlers = (store: SavedFilter[] = [], api = 'http://localhost:8000/api') => {
    const sorted = () => [...store].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const clash = (name: string, id?: string) =>
        store.some(item => item.id !== id && item.name.toLowerCase() === name.trim().toLowerCase());
    return [
        http.get(`${api}/saved-filters/`, () => HttpResponse.json(sorted())),
        http.post(`${api}/saved-filters/`, async ({ request }) => {
            const body = await request.json() as SavedFilterWrite;
            if (clash(body.name ?? '')) {
                return HttpResponse.json({ name: [`There is already a filter named “${body.name}”.`] }, { status: 400 });
            }
            const saved: SavedFilter = {
                id: `saved-${store.length + 1}`, name: (body.name ?? '').trim(),
                filter: normalizeFilter(body.filter ?? {}), created_at: '2026-10-08T10:00:00Z',
            };
            store.push(saved);
            return HttpResponse.json(saved, { status: 201 });
        }),
        http.patch(`${api}/saved-filters/:id/`, async ({ params, request }) => {
            const body = await request.json() as SavedFilterWrite;
            const saved = store.find(item => item.id === params.id);
            if (!saved) return new HttpResponse(null, { status: 404 });
            if (body.name !== undefined) saved.name = body.name.trim();
            if (body.filter) saved.filter = normalizeFilter(body.filter);
            return HttpResponse.json(saved);
        }),
        http.delete(`${api}/saved-filters/:id/`, ({ params }) => {
            store.splice(store.findIndex(item => item.id === params.id), 1);
            return new HttpResponse(null, { status: 204 });
        }),
    ];
};
