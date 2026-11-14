/** Test servers (msw) for views with the tracker (docs/sort-time.md):
 *  nothing to sort, unless ``store`` holds blocks; "Start work" and its stop
 *  keep ``store`` up to date. */
import { http, HttpResponse } from 'msw';

import type { WorkBlock } from '../types.ts';

export const workBlockHandlers = (store: WorkBlock[] = [], api = 'http://localhost:8000/api') => [
    http.get(`${api}/work-blocks/`, () => HttpResponse.json(store.filter(block => block.sorted_at === null))),
    http.get(`${api}/work-blocks/suggestions/`, () => HttpResponse.json([])),
    http.post(`${api}/work-blocks/start/`, () => {
        const block: WorkBlock = {
            id: `block-${store.length + 1}`, start: new Date().toISOString(), end: null, origin: 'started',
            sorted_at: null, original_task_id: null, running: true, seconds: 0, items: [],
        };
        store.push(block);
        return HttpResponse.json(block, { status: 201 });
    }),
    http.post(`${api}/work-blocks/stop/`, () => {
        const block = store.find(candidate => candidate.running);
        if (!block) return HttpResponse.json({ detail: 'Work begun with “Start work” is not running.' }, { status: 400 });
        // As if it had begun two hours ago.
        Object.assign(block, { running: false, start: new Date(Date.now() - 2 * 3600_000).toISOString(),
            end: new Date().toISOString(), seconds: 2 * 3600 });
        return HttpResponse.json(block);
    }),
];
