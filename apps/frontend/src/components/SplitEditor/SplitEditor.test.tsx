/**
 * UI-6 acceptance (docs/task-entry-ui.md §11 scenario 3 and §10 UI-6).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SplitEditor } from './SplitEditor.tsx';
import { API, makeTask, makerTag, settingsFor } from '../../testing/treeFixtures.ts';
import type { SplitRequest, Task } from '../../types.ts';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';

let tasks: Task[] = [];
let requests: SplitRequest[] = [];
let splitResponse: () => Response = () => HttpResponse.json({ task: {}, children: [] });

const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json(tasks)),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settingsFor(tasks, null))),
    http.post(`${API}/tasks/:id/split/`, async ({ request }) => {
        requests.push(await request.json() as SplitRequest);
        return splitResponse();
    }),
    http.post(`${API}/tags/`, async ({ request }) => {
        const { name } = await request.json() as { name: string };
        return HttpResponse.json({ id: `tag-${name}`, name, hex_color: '#000000' }, { status: 201 });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    cleanup();
    server.resetHandlers();
    requests = [];
    splitResponse = () => HttpResponse.json({ task: {}, children: [] });
});
afterAll(() => server.close());

const hardware = (over: Partial<Task> = {}) => makeTask('hw', {
    header: 'Hardware Design', duration: '12:00:00', tags: [makerTag], priority: 7, ...over,
});

async function renderEditor(task: Task, onClose = vi.fn()) {
    tasks = [task, ...tasks.filter(t => t.id !== task.id)];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SplitEditor open task={task} onClose={onClose} /></QueryClientProvider>);
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    return onClose;
}

const headers = () => screen.getAllByRole('textbox', { name: /^part \d+$/i });

describe('SplitEditor — loading', () => {
    it('waits for the task tree instead of starting from an empty outline', async () => {
        tasks = [makeTask('p0', { header: 'CAD', parent_id: 'hw', ancestor_ids: ['hw'] })];
        let release: () => void = () => {};
        server.use(http.get(`${API}/tasks/`, async () => {
            await new Promise<void>(resolve => { release = resolve; });
            return HttpResponse.json(tasks);
        }));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}>
            <SplitEditor open task={hardware({ children_ids: ['p0'] })} onClose={vi.fn()} />
        </QueryClientProvider>);
        expect(await screen.findByLabelText('loading')).toBeInTheDocument();
        release();
        await waitFor(() => expect(headers()[0]).toHaveValue('CAD'));
    });
});
const estimates = () => screen.getAllByRole('textbox', { name: /^estimate of part/i });

describe('SplitEditor — scenario 3', () => {
    it('splits a fresh task: ghosts add up, typed values rebalance, the chain is on', async () => {
        tasks = [];
        const onClose = await renderEditor(hardware());
        const names = ['CAD', 'test prints', 'component orders', 'CAD refinements', 'assembly'];
        names.forEach((name, i) => {
            fireEvent.change(headers()[i], { target: { value: name } });
            if (i < names.length - 1) fireEvent.keyDown(headers()[i], { key: 'Enter' });
        });
        expect(estimates().map(e => e.getAttribute('placeholder')))
            .toEqual(['~2h 30m', '~2h 30m', '~2h 30m', '~2h 15m', '~2h 15m']);

        fireEvent.change(estimates()[0], { target: { value: '3h' } });
        expect(estimates().slice(1).map(e => e.getAttribute('placeholder')))
            .toEqual(['~2h 15m', '~2h 15m', '~2h 15m', '~2h 15m']);
        expect(screen.getByRole('checkbox', { name: /do these in this order/i })).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].sequential).toBe(true);
        expect(requests[0].estimate).toBeUndefined(); // the budget stays 12h
        expect(requests[0].children.map(c => [c.header, c.duration])).toEqual([
            ['CAD', '03:00:00'], ['test prints', '02:15:00'], ['component orders', '02:15:00'],
            ['CAD refinements', '02:15:00'], ['assembly', '02:15:00'],
        ]);
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('reopened with 4h for assembly: shows the overflow and sets the estimate to the sum', async () => {
        const parts = [['CAD', '03:00:00'], ['test prints', '02:15:00'], ['component orders', '02:15:00'],
            ['CAD refinements', '02:15:00'], ['assembly', '02:15:00']];
        tasks = parts.map(([header, duration], i) =>
            makeTask(`p${i}`, { header, duration, parent_id: 'hw', ancestor_ids: ['hw'], order: i }));
        await renderEditor(hardware({ children_ids: parts.map((_, i) => `p${i}`) }));

        fireEvent.change(estimates()[4], { target: { value: '4h' } });
        expect(screen.getByText(/1h 45m over the estimate/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /set estimate to Σ parts \(13h 45m\)/i }));
        expect(screen.getByRole('textbox', { name: /^estimate$/i })).toHaveValue('13:45');
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0]).toMatchObject({ estimate: '13:45:00', estimate_reason: 'set_to_sum' });
        expect(requests[0].children.map(c => c.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
        expect(requests[0].children[4].duration).toBe('04:00:00');
    });

    it('"Raise estimate" in the overflow summary records why', async () => {
        tasks = [];
        await renderEditor(hardware({ duration: '02:00:00' }));
        fireEvent.change(headers()[0], { target: { value: 'CAD' } });
        fireEvent.change(estimates()[0], { target: { value: '3h' } });
        fireEvent.click(screen.getByRole('button', { name: /raise estimate to 3h/i }));
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(requests[0]).toMatchObject({ estimate: '03:00:00', estimate_reason: 'raised_from_warning' }));
    });
});

describe('SplitEditor — more', () => {
    it('saves a pasted, indented list as nested parts', async () => {
        tasks = [];
        await renderEditor(hardware());
        fireEvent.paste(headers()[0], {
            clipboardData: { getData: () => 'Housing\n  front 2h\n  back\nFirmware 4h' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(requests).toHaveLength(1));
        const [housing, firmware] = requests[0].children;
        expect(housing.header).toBe('Housing');
        expect(housing.children!.map(c => [c.header, c.duration])).toEqual([['front', '02:00:00'], ['back', '06:00:00']]);
        expect(firmware).toMatchObject({ header: 'Firmware', duration: '04:00:00' });
    });

    it('sends the inheritance and order choices', async () => {
        tasks = [];
        await renderEditor(hardware());
        fireEvent.change(headers()[0], { target: { value: 'CAD' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /do these in this order/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /tags/i }));
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(requests[0]).toMatchObject({
            sequential: false, inherit_tags: false, inherit_priority: true,
        }));
    });

    it('shows the server’s reason when the save is refused', async () => {
        tasks = [];
        splitResponse = () => HttpResponse.json(
            { detail: '“CAD” can’t be removed because time was already tracked on it.' }, { status: 400 });
        const onClose = await renderEditor(hardware());
        fireEvent.change(headers()[0], { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(await screen.findByText(/time was already tracked/)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('refuses an estimate it cannot read', async () => {
        tasks = [];
        await renderEditor(hardware());
        fireEvent.change(screen.getByRole('textbox', { name: /^estimate$/i }), { target: { value: 'lots' } });
        expect(within(screen.getByRole('dialog')).getByText(/not a duration/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    });
});

describe('SplitEditor on a phone (UI-9)', () => {
    it('fills the screen, without the keyboard help', async () => {
        const restore = fakeScreen(PHONE);
        try {
            await renderEditor(hardware());
            expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperFullScreen');
            // Tab / Alt keys don't exist there: the row buttons replace the help line.
            expect(screen.queryByText(/Tab \/ Shift\+Tab/)).toBeNull();
        } finally {
            restore();
        }
    });
});

