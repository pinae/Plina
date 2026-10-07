/** Test servers (msw) for views that ask about calendars (README: Calendar):
 *  no markers, no calendars, nothing changed by a read. */
import { http, HttpResponse } from 'msw';

export const calendarHandlers = (api = 'http://localhost:8000/api') => [
    http.get(`${api}/markers/`, () => HttpResponse.json([])),
    http.get(`${api}/calendars/`, () => HttpResponse.json([])),
    http.post(`${api}/calendars/sync/`, () => HttpResponse.json({ changed: false, calendars: [] })),
];

/** The Week view also shows special buckets (from the bucket types): for
 *  test servers that have no bucket types of their own. */
export const noBucketTypes = (api = 'http://localhost:8000/api') => [
    http.get(`${api}/buckettypes/`, () => HttpResponse.json([])),
];
