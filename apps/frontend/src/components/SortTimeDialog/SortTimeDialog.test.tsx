/**
 * The sheet that sorts tracked time afterwards (docs/sort-time.md, S8):
 * tick what was done, the stretch is shared out by estimates.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SortTimeProvider } from './SortTimeDialog.tsx';
import { useOpenSortTime, type SortTarget } from './sortTimeContext.ts';
import { API, makeTask, makerTag, settingsFor } from '../../testing/treeFixtures.ts';
import type { Task, TrackedSession, WorkBlock } from '../../types.ts';

// Local times: the sheet shows the user's clock.
const at = (hour: number, minute = 0) => new Date(2026, 10, 16, hour, minute).toISOString();

const tasks = (): Task[] => [
    makeTask('web', { header: 'Website', children_ids: ['header', 'footer'], duration: null, is_estimated: false }),
    makeTask('header', { header: 'Header', parent_id: 'web', ancestor_ids: ['web'], duration: '01:00:00', time_spent: '03:00:00' }),
    makeTask('footer', { header: 'Footer', parent_id: 'web', ancestor_ids: ['web'], order: 1, duration: '00:30:00' }),
    makeTask('invoice', { header: 'Invoice', duration: '00:30:00' }),
];
const session: TrackedSession = {
    id: 's1', task_id: 'header', task_header: 'Header', task_tags: [], start: at(9), end: at(12),
    running: false, seconds: 3 * 3600,
};
const sorted = (over: Partial<WorkBlock> = {}): WorkBlock => ({
    id: 'b1', start: at(9), end: at(12), origin: 'split', sorted_at: at(13), original_task_id: 'header',
    running: false, seconds: 3 * 3600, items: [], ...over,
});

let sent: { method: string; path: string; body: unknown }[] = [];
const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json(tasks())),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json({ ...settingsFor(tasks(), null), default_duration: '01:00:00' })),
    http.get(`${API}/work-blocks/suggestions/`, () => HttpResponse.json([
        { task_id: 'header', reason: 'tracked' }, { task_id: 'footer', reason: 'same project' },
        { task_id: 'invoice', reason: 'planned' },
    ])),
    http.get(`${API}/work-blocks/`, () => HttpResponse.json([])),
    http.post(`${API}/work-blocks/`, async ({ request }) => {
        sent.push({ method: 'POST', path: 'work-blocks/', body: await request.json() });
        return HttpResponse.json(sorted(), { status: 201 });
    }),
    http.post(`${API}/work-blocks/:id/sort/`, async ({ request, params }) => {
        sent.push({ method: 'POST', path: `work-blocks/${params.id}/sort/`, body: await request.json() });
        return HttpResponse.json(sorted({ id: String(params.id), origin: 'started' }));
    }),
    http.delete(`${API}/work-blocks/:id/`, ({ params }) => {
        sent.push({ method: 'DELETE', path: `work-blocks/${params.id}/`, body: null });
        return new HttpResponse(null, { status: 204 });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => { sent = []; });
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

function Opener({ target }: { target: SortTarget }) {
    const open = useOpenSortTime();
    return <button onClick={() => open(target)}>open</button>;
}

async function openSheet(target: SortTarget) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SortTimeProvider><Opener target={target} /></SortTimeProvider></QueryClientProvider>);
    fireEvent.click(screen.getByText('open'));
    const dialog = await screen.findByRole('dialog', { name: /sort 09:00 – 12:00 · 3h/i });
    await within(dialog).findByText('Invoice'); // the suggestions are there
    return dialog;
}

const tick = (dialog: HTMLElement, header: string) => within(dialog).getByRole('checkbox', { name: header });
const share = (dialog: HTMLElement, header: string) => within(dialog).getByTestId(`share-${header}`).textContent;
const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: /^save/i }));

describe('sorting a session that covered several tasks', () => {
    it('starts with its task ticked and offers the suggestions', async () => {
        const dialog = await openSheet({ session });
        expect(tick(dialog, 'Header')).toHaveAttribute('aria-checked', 'true');
        expect(tick(dialog, 'Footer')).toHaveAttribute('aria-checked', 'false');
        expect(within(dialog).getByText('same project')).toBeInTheDocument();
        expect(share(dialog, 'Header')).toBe('3h');
    });

    it('ticking shares the time by estimates (what is left of them)', async () => {
        const dialog = await openSheet({ session });
        fireEvent.click(tick(dialog, 'Footer'));
        // Header: 1h estimate, its 3h are this session's (split: not counted) → 60 : 30.
        expect(share(dialog, 'Header')).toBe('2h');
        expect(share(dialog, 'Footer')).toBe('1h');
    });

    it('a second tap is “worked on” (half), a third unticks', async () => {
        const dialog = await openSheet({ session });
        fireEvent.click(tick(dialog, 'Footer'));
        fireEvent.click(tick(dialog, 'Footer'));
        expect(tick(dialog, 'Footer')).toHaveAttribute('aria-checked', 'mixed');
        expect(share(dialog, 'Footer')).toBe('36m'); // 60 : 15
        fireEvent.click(tick(dialog, 'Footer'));
        expect(tick(dialog, 'Footer')).toHaveAttribute('aria-checked', 'false');
    });

    it('typed minutes are pinned, the rest scales; too many are refused', async () => {
        const dialog = await openSheet({ session });
        fireEvent.click(tick(dialog, 'Footer'));
        fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Minutes for Footer' }), { target: { value: '30' } });
        expect(share(dialog, 'Header')).toBe('2h 30m');
        fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Minutes for Footer' }), { target: { value: '200' } });
        expect(within(dialog).getByText(/more than the 3h to share/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /^save/i })).toBeDisabled();
    });

    it('saves the ticked rows in their order, then offers Undo', async () => {
        const dialog = await openSheet({ session });
        fireEvent.click(tick(dialog, 'Invoice'));
        fireEvent.click(tick(dialog, 'Footer'));
        fireEvent.click(tick(dialog, 'Footer'));
        save(dialog);
        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]).toEqual({ method: 'POST', path: 'work-blocks/', body: { session_id: 's1', items: [
            { task_id: 'header', completed: true, pinned_minutes: null },
            { task_id: 'footer', completed: false, pinned_minutes: null },
            { task_id: 'invoice', completed: true, pinned_minutes: null },
        ] } });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(sent[1]).toEqual({ method: 'DELETE', path: 'work-blocks/b1/', body: null }));
    });
});

describe('fast with the keyboard', () => {
    it('Enter ticks a match or adds a done task; Enter on nothing saves', async () => {
        const dialog = await openSheet({ block: sorted({ id: 'b9', origin: 'started', sorted_at: null, original_task_id: null }) });
        const find = within(dialog).getByRole('combobox', { name: /find or add/i });
        act(() => find.focus());
        fireEvent.change(find, { target: { value: 'foot' } });
        fireEvent.keyDown(find, { key: 'Enter' });
        expect(tick(dialog, 'Footer')).toHaveAttribute('aria-checked', 'true');
        expect(find).toHaveValue('');
        fireEvent.change(find, { target: { value: 'Hotfix login 45m #maker' } });
        fireEvent.keyDown(find, { key: 'Enter' });
        expect(tick(dialog, 'Hotfix login')).toHaveAttribute('aria-checked', 'true');
        expect(within(dialog).getByText('new')).toBeInTheDocument();
        fireEvent.keyDown(find, { key: 'Enter' });

        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]).toEqual({ method: 'POST', path: 'work-blocks/b9/sort/', body: { items: [
            { task_id: 'footer', completed: true, pinned_minutes: null },
            { new: { header: 'Hotfix login', duration: '00:45:00', parent_id: null, tag_ids: ['tag-maker'] },
              completed: true, pinned_minutes: null },
        ] } });
    });

    it('↓ goes from the search to the rows; Space ticks there', async () => {
        const dialog = await openSheet({ gap: { start: at(9), end: at(12) } });
        const find = within(dialog).getByRole('combobox', { name: /find or add/i });
        fireEvent.keyDown(find, { key: 'ArrowDown' });
        expect(tick(dialog, 'Header')).toHaveFocus();
        fireEvent.keyDown(tick(dialog, 'Header'), { key: 'ArrowDown' });
        expect(tick(dialog, 'Footer')).toHaveFocus();
        fireEvent.keyDown(tick(dialog, 'Footer'), { key: ' ' });
        expect(tick(dialog, 'Footer')).toHaveAttribute('aria-checked', 'true');
    });
});

describe('a gap', () => {
    it('saves its start and end', async () => {
        const dialog = await openSheet({ gap: { start: at(9), end: at(12) } });
        fireEvent.click(tick(dialog, 'Invoice'));
        save(dialog);
        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0].body).toEqual({ start: at(9), end: at(12),
            items: [{ task_id: 'invoice', completed: true, pinned_minutes: null }] });
    });

    it('nothing ticked: nothing to save', async () => {
        const dialog = await openSheet({ gap: { start: at(9), end: at(12) } });
        expect(within(dialog).getByRole('button', { name: /^save/i })).toBeDisabled();
    });
});
