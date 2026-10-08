/**
 * Task form validation in the dialog: invalid fields turn red (aria-invalid,
 * animated outline) with a plain-language message, nothing is sent until the
 * form is valid, and server-side field errors land on the right field.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';

import { TaskFormDialog } from './TaskFormDialog.tsx';
import { treeDefaults } from '../../testing/treeFixtures.ts';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';
import { calendarHandlers } from '../../testing/calendarHandlers.ts';

const API = 'http://localhost:8000/api';
let posted: Record<string, unknown>[] = [];

const server = setupServer(
    ...calendarHandlers(),
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.get(`${API}/tasks/`, () => HttpResponse.json([])),
    http.get(`${API}/settings/`, () => HttpResponse.json({
        default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
    })),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posted.push(body);
        return HttpResponse.json({ id: 'new', ...body }, { status: 201 });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); posted = []; });
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const headerInput = () => screen.getByRole('textbox', { name: /^header$/i });
const durationInput = () => screen.getByRole('textbox', { name: /duration/i });
const clickCreate = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('TaskFormDialog validation', () => {
    it('shows no errors before the user interacts', () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        expect(headerInput()).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText(/header is empty/i)).toBeNull();
    });

    it('marks an empty header red with an explanation, focuses it and sends nothing', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        clickCreate();

        expect(await screen.findByText(/header is empty/i)).toBeInTheDocument();
        expect(headerInput()).toHaveAttribute('aria-invalid', 'true');
        await waitFor(() => expect(headerInput()).toHaveFocus());
        expect(screen.getByText(/fix the highlighted field/i)).toBeInTheDocument();
        expect(posted).toHaveLength(0);
    });

    it('saves an empty duration as "use my default" but explains a malformatted one (UI-8)', async () => {
        const onClose = vi.fn();
        render(<TaskFormDialog open onClose={onClose} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Report' } });
        expect(await screen.findByText('Empty = your default (1h)')).toBeInTheDocument();

        fireEvent.change(durationInput(), { target: { value: 'two hours' } });
        clickCreate();
        expect(await screen.findByText(/“two hours” is not a valid duration/)).toBeInTheDocument();
        expect(durationInput()).toHaveAttribute('aria-invalid', 'true');
        expect(posted).toHaveLength(0);

        fireEvent.change(durationInput(), { target: { value: '' } });
        clickCreate();
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0].duration).toBeNull();
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('clears an error live once the input is fixed', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        clickCreate();
        await screen.findByText(/header is empty/i);

        fireEvent.change(headerInput(), { target: { value: 'Now it has a name' } });

        await waitFor(() => expect(screen.queryByText(/header is empty/i)).toBeNull());
        expect(headerInput()).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('validates a field on blur, before any submit', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(durationInput(), { target: { value: '-3' } });
        fireEvent.blur(durationInput());
        expect(await screen.findByText(/can't be negative/i)).toBeInTheDocument();
        // Untouched fields stay quiet.
        expect(screen.queryByText(/header is empty/i)).toBeNull();
    });

    it('requires a start time for appointments', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Standup' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /appointment/i }));
        clickCreate();

        expect(await screen.findByText(/appointment needs a start time/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^start/i)).toHaveAttribute('aria-invalid', 'true');
        expect(posted).toHaveLength(0);
    });

    it('explains an incompletely typed deadline', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        const deadline = screen.getByLabelText(/deadline/i);
        // A partially typed datetime-local reports value "" + validity.badInput.
        Object.defineProperty(deadline, 'validity', { value: { badInput: true }, configurable: true });
        fireEvent.change(deadline, { target: { value: '' } });
        fireEvent.blur(deadline);

        expect(await screen.findByText(/deadline is incomplete/i)).toBeInTheDocument();
    });

    it('saves a task with an empty description (regression)', async () => {
        const onClose = vi.fn();
        render(<TaskFormDialog open onClose={onClose} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'No description' } });
        fireEvent.change(durationInput(), { target: { value: '1,5' } }); // German decimal comma
        clickCreate();

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ header: 'No description', description: '', duration: '01:30:00' });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows a server-side field error on the matching field', async () => {
        server.use(http.post(`${API}/tasks/`, () => HttpResponse.json(
            { header: ['Ensure this field has no more than 1024 characters.'] }, { status: 400 },
        )));
        const onClose = vi.fn();
        render(<TaskFormDialog open onClose={onClose} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Rejected by server' } });
        clickCreate();

        expect(await screen.findByText(/server rejected this value.*1024/i)).toBeInTheDocument();
        expect(headerInput()).toHaveAttribute('aria-invalid', 'true');
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('TaskFormDialog — splitting (UI-6)', () => {
    const existing = {
        id: 'hw', header: 'Hardware Design', description: '', start_date: null, duration: '12:00:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 7, tags: [], hex_color: null,
        is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
        active_tracking_start: null, ...treeDefaults, children_ids: [],
    };

    it('offers "Split into subtasks" when editing and opens the split editor', async () => {
        server.use(
            http.get(`${API}/tasks/`, () => HttpResponse.json([existing])),
            http.get(`${API}/settings/`, () => HttpResponse.json({
                default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
            })),
        );
        const onClose = vi.fn();
        render(<TaskFormDialog open task={existing} onClose={onClose} />, { wrapper });
        fireEvent.click(screen.getByRole('button', { name: /split into subtasks/i }));
        expect(await screen.findByText('Split “Hardware Design”')).toBeInTheDocument();
        expect(screen.queryByText('Edit “Hardware Design”')).toBeNull();

        fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
        expect(onClose).toHaveBeenCalled();
    });

    it('calls it "Edit parts" for a task that already has subtasks', () => {
        render(<TaskFormDialog open task={{ ...existing, children_ids: ['a', 'b'] }} onClose={() => {}} />, { wrapper });
        expect(screen.getByRole('button', { name: /edit parts \(2\)/i })).toBeInTheDocument();
    });

    it('is not offered for a new task', () => {
        render(<TaskFormDialog open onClose={() => {}} />, { wrapper });
        expect(screen.queryByRole('button', { name: /split into subtasks/i })).toBeNull();
    });
});

describe('TaskFormDialog — the task tree (UI-8)', () => {
    const task = (id: string, over: Record<string, unknown> = {}) => ({
        id, header: id, description: '', start_date: null, duration: '01:00:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null,
        is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
        active_tracking_start: null, ...treeDefaults, parent_id: null, children_ids: [], ancestor_ids: [], ...over,
    });
    const tree = [
        task('t250', { header: 'T250', children_ids: ['hw'], latest_finish_date: '2026-10-31T23:59:00Z' }),
        task('hw', { header: 'Hardware Design', parent_id: 't250', ancestor_ids: ['t250'], children_ids: ['cad'],
            duration: '12:00:00', parts_total: '14:00:00', over_budget: true, time_spent: '01:00:00' }),
        task('cad', { header: 'CAD', parent_id: 'hw', ancestor_ids: ['t250', 'hw'], duration: '14:00:00' }),
        task('blog', { header: 'Company Blog' }),
    ];
    const patches: Record<string, unknown>[] = [];
    const useTree = (activeId: string | null) => server.use(
        http.get(`${API}/tasks/`, () => HttpResponse.json(tree)),
        http.get(`${API}/settings/`, () => HttpResponse.json({
            default_duration: '00:30:00', active_task_id: activeId, active_task_path: [], time_zone: '',
        })),
        http.patch(`${API}/tasks/:id/`, async ({ request }) => {
            patches.push(await request.json() as Record<string, unknown>);
            return HttpResponse.json(tree[1]);
        }),
    );
    const parentInput = () => screen.getByRole('combobox', { name: /parent/i });
    afterEach(() => { patches.length = 0; });

    it('preselects the active project as parent of a new task', async () => {
        useTree('hw');
        render(<TaskFormDialog open onClose={() => {}} />, { wrapper });
        await waitFor(() => expect(parentInput()).toHaveValue('T250 › Hardware Design'));
        fireEvent.change(headerInput(), { target: { value: 'assembly' } });
        clickCreate();
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ parent_id: 'hw' });
        expect(posted[0]).not.toHaveProperty('project_id');
    });

    it('can make the task top-level by clearing the parent', async () => {
        useTree('hw');
        render(<TaskFormDialog open onClose={() => {}} />, { wrapper });
        await waitFor(() => expect(parentInput()).toHaveValue('T250 › Hardware Design'));
        fireEvent.change(parentInput(), { target: { value: '' } });
        expect(await screen.findByText('Empty = a project of its own')).toBeInTheDocument();
        fireEvent.change(headerInput(), { target: { value: 'Buy milk' } });
        clickCreate();
        await waitFor(() => expect(posted[0]).toMatchObject({ parent_id: null }));
    });

    it('never offers the task itself or its subtasks as parent', async () => {
        useTree(null);
        render(<TaskFormDialog open task={tree[1] as never} onClose={() => {}} />, { wrapper });
        await waitFor(() => expect(parentInput()).toHaveValue('T250'));
        fireEvent.mouseDown(parentInput());
        const options = (await screen.findAllByRole('option')).map(o => o.textContent);
        expect(options).toEqual(['T250', 'Company Blog']);
    });

    it('shows Σ parts / estimate for a parent and can adopt the sum', async () => {
        useTree(null);
        render(<TaskFormDialog open task={tree[1] as never} onClose={() => {}} />, { wrapper });
        expect(await screen.findByText(/Σ parts 14h \/ 12h/)).toBeInTheDocument();
        // Σ parts 14h + 1h already spent on the parent → no Rest left.
        fireEvent.click(screen.getByRole('button', { name: /set estimate to Σ parts \(15h\)/i }));
        expect(durationInput()).toHaveValue('15');
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({ duration: '15:00:00', estimate_reason: 'set_to_sum' });
    });

    it('shows the time spent against the estimate', async () => {
        useTree(null);
        render(<TaskFormDialog open task={{ ...tree[1], time_spent: '13:20:00' } as never} onClose={() => {}} />, { wrapper });
        expect(await screen.findByText('Spent 13h 20m of 12h (+1h 20m)')).toBeInTheDocument();
    });

    it('rejects a deadline later than a parent’s', async () => {
        useTree(null);
        render(<TaskFormDialog open task={tree[2] as never} onClose={() => {}} />, { wrapper });
        await waitFor(() => expect(parentInput()).toHaveValue('T250 › Hardware Design'));
        fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: '2026-11-15T12:00' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(await screen.findByText(/later than the deadline of “T250”/)).toBeInTheDocument();
        expect(patches).toHaveLength(0);
    });
});

describe('TaskFormDialog — colors (§4.4)', () => {
    const task = (id: string, over: Record<string, unknown> = {}) => ({
        id, header: id, description: '', start_date: null, duration: '01:00:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null,
        is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
        active_tracking_start: null, ...treeDefaults, ...over,
    });
    const webshop = task('webshop', { header: 'Webshop', children_ids: ['schema'],
        hex_color: '#8489da', inherited_hex_color: '#8489da' });
    const schema = task('schema', { header: 'Design schema', parent_id: 'webshop', ancestor_ids: ['webshop'],
        hex_color: '#8489da', inherited_hex_color: '#8489da' });
    const blog = task('blog', { header: 'Blog', hex_color: '#ca5551', own_hex_color: '#ca5551',
        inherited_hex_color: '#9f7100' });
    const patches: Record<string, unknown>[] = [];
    const useTree = () => server.use(
        http.get(`${API}/tasks/`, () => HttpResponse.json([webshop, schema, blog])),
        http.patch(`${API}/tasks/:id/`, async ({ request }) => {
            patches.push(await request.json() as Record<string, unknown>);
            return HttpResponse.json(schema);
        }),
    );
    afterEach(() => { patches.length = 0; });
    const save = () => fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    it('shows the parent\'s color for a subtask and saves a chosen one', async () => {
        useTree();
        render(<TaskFormDialog open onClose={() => { }} task={schema} />, { wrapper });
        await waitFor(() => expect(screen.getByTestId('default-swatch')).toHaveStyle({ backgroundColor: '#8489da' }));
        expect(screen.getByRole('button', { name: /from parent/i })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Green' }));
        save();
        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({ own_hex_color: '#25984d' });
    });

    it('goes back to automatic for a project with a chosen color', async () => {
        useTree();
        render(<TaskFormDialog open onClose={() => { }} task={blog} />, { wrapper });
        expect(screen.getByRole('button', { name: 'Red' })).toHaveAttribute('aria-pressed', 'true');
        // Previews the project's automatic color, not the chosen one.
        expect(screen.getByTestId('default-swatch')).toHaveStyle({ backgroundColor: '#9f7100' });

        fireEvent.click(screen.getByRole('button', { name: /automatic/i }));
        save();
        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({ own_hex_color: null });
    });

    it('previews the color of the parent chosen in the form', async () => {
        useTree();
        render(<TaskFormDialog open onClose={() => { }} task={schema} />, { wrapper });
        await waitFor(() => expect(screen.getByRole('combobox', { name: /parent/i })).toHaveValue('Webshop'));
        fireEvent.mouseDown(screen.getByRole('combobox', { name: /parent/i }));
        fireEvent.click(await screen.findByRole('option', { name: 'Blog' }));
        expect(screen.getByTestId('default-swatch')).toHaveStyle({ backgroundColor: '#ca5551' });
    });

    it('counts a changed color as an unsaved change', async () => {
        useTree();
        const onNavigate = vi.fn();
        render(<TaskFormDialog open onClose={() => { }} task={schema} onNavigate={onNavigate}
            canNavigate={{ previous: true, next: true }} />, { wrapper });
        fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
        fireEvent.click(screen.getByRole('button', { name: /next task/i }));
        await waitFor(() => expect(patches).toHaveLength(1)); // saved before switching
        expect(patches[0]).toMatchObject({ own_hex_color: '#477ed8' });
    });
});

describe('TaskFormDialog on a phone (UI-9)', () => {
    it('fills the screen', async () => {
        const restore = fakeScreen(PHONE);
        try {
            render(<TaskFormDialog open onClose={vi.fn()} />, { wrapper });
            expect(await screen.findByRole('dialog')).toHaveClass('MuiDialog-paperFullScreen');
        } finally {
            restore();
        }
    });
});

describe('TaskFormDialog — walking through tasks (T-4, like Todoist)', () => {
    const task = (id: string, header: string) => ({
        id, header, description: '', start_date: null, duration: '01:00:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null,
        is_fixed: false, is_appointment: false, completed_at: null, is_done: false,
        active_tracking_start: null, ...treeDefaults,
    });
    const list = [task('cad', 'CAD'), task('blog', 'Company Blog'), task('milk', 'Buy milk')];
    const patches: { id: string; body: Record<string, unknown> }[] = [];
    const useServer = () => server.use(
        http.get(`${API}/tasks/`, () => HttpResponse.json(list)),
        http.patch(`${API}/tasks/:id/`, async ({ params, request }) => {
            const body = await request.json() as Record<string, unknown>;
            patches.push({ id: String(params.id), body });
            return HttpResponse.json({ ...list.find(t => t.id === params.id), ...body });
        }),
    );
    afterEach(() => { patches.length = 0; });

    /** The outline's role: keep the dialog open and swap the task. */
    function Walker({ onNavigate }: { onNavigate?: (direction: -1 | 1) => void }) {
        const [index, setIndex] = useState(0);
        return (
            <TaskFormDialog open onClose={() => {}} task={list[index]}
                canNavigate={{ previous: index > 0, next: index < list.length - 1 }}
                onNavigate={direction => { onNavigate?.(direction); setIndex(i => i + direction); }} />
        );
    }
    const next = () => fireEvent.click(screen.getByRole('button', { name: /next task/i }));

    it('switches to the next task in the same dialog when nothing changed', async () => {
        useServer();
        const onNavigate = vi.fn();
        render(<Walker onNavigate={onNavigate} />, { wrapper });
        const dialog = screen.getByRole('dialog');
        expect(screen.getByRole('button', { name: /previous task/i })).toBeDisabled();
        next();
        await waitFor(() => expect(headerInput()).toHaveValue('Company Blog'));
        expect(onNavigate).toHaveBeenCalledWith(1);
        expect(patches).toEqual([]);
        expect(screen.getByRole('dialog')).toBe(dialog); // not closed and reopened
        expect(dialog).toHaveTextContent('Edit “Company Blog”');
        expect(headerInput()).toHaveFocus();
    });

    it('saves unsaved changes first', async () => {
        useServer();
        render(<Walker />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'CAD v2' } });
        next();
        await waitFor(() => expect(headerInput()).toHaveValue('Company Blog'));
        expect(patches).toHaveLength(1);
        expect(patches[0]).toMatchObject({ id: 'cad', body: { header: 'CAD v2' } });
    });

    it('refuses to switch while the form is invalid', async () => {
        useServer();
        const onNavigate = vi.fn();
        render(<Walker onNavigate={onNavigate} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: '' } });
        next();
        await waitFor(() => expect(headerInput()).toHaveAttribute('aria-invalid', 'true'));
        expect(onNavigate).not.toHaveBeenCalled();
        expect(patches).toEqual([]);
    });

    it('Alt+↓ / Alt+↑ switch from the keyboard', async () => {
        useServer();
        const onNavigate = vi.fn();
        render(<Walker onNavigate={onNavigate} />, { wrapper });
        fireEvent.keyDown(headerInput(), { key: 'ArrowDown', altKey: true });
        await waitFor(() => expect(headerInput()).toHaveValue('Company Blog'));
        fireEvent.keyDown(headerInput(), { key: 'ArrowUp', altKey: true });
        await waitFor(() => expect(headerInput()).toHaveValue('CAD'));
        expect(onNavigate.mock.calls).toEqual([[1], [-1]]);
    });

    it('has no arrows without a list to walk (e.g. from the Week view)', () => {
        render(<TaskFormDialog open onClose={() => {}} task={list[0]} />, { wrapper });
        expect(screen.queryByRole('button', { name: /next task/i })).toBeNull();
    });
});


describe('TaskFormDialog — repeats (README: Recurring tasks)', () => {
    const previewHandler = http.post(`${API}/recurrence-preview/`, async ({ request }) => {
        const { recurrence } = (await request.json()) as { recurrence: string };
        if (recurrence === 'every sometimes') {
            return HttpResponse.json({ detail: 'Plina does not understand “sometimes” in “every sometimes”.' },
                { status: 400 });
        }
        return HttpResponse.json({
            description: 'every Tuesday at 20:00',
            occurrences: ['2026-10-06T20:00:00+02:00', '2026-10-13T20:00:00+02:00'],
        });
    });
    const repeats = () => screen.getByRole('textbox', { name: /repeats/i });
    const occurrence = {
        id: 'chore', header: 'Water plants', description: '', start_date: null, duration: '00:15:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null,
        is_fixed: false, is_appointment: false, completed_at: null, is_done: false, active_tracking_start: null,
        ...treeDefaults, recurrence: 'every tuesday 20:00', recurrence_description: 'every Tuesday at 20:00',
        series_id: 's1', occurrence: '2026-10-13T20:00:00+02:00', next_occurrence: '2026-10-20T20:00:00+02:00',
        occurrence_count: 3,
    };

    it('previews the rule in words and saves it', async () => {
        server.use(previewHandler);
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Water plants' } });
        fireEvent.change(repeats(), { target: { value: 'every tuesday 20:00' } });
        expect(await screen.findByTestId('recurrence-description')).toHaveTextContent('every Tuesday at 20:00');
        expect(screen.getAllByTestId('preview-occurrence')).toHaveLength(2);
        clickCreate();
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ header: 'Water plants', recurrence: 'every tuesday 20:00' });
    });

    it('says what it does not understand, also after saving', async () => {
        server.use(previewHandler, http.post(`${API}/tasks/`, () => HttpResponse.json(
            { recurrence: ['Plina does not understand “sometimes” in “every sometimes”.'] }, { status: 400 })));
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Odd' } });
        fireEvent.change(repeats(), { target: { value: 'every sometimes' } });
        expect(await screen.findByText(/does not understand “sometimes”/)).toBeInTheDocument();
        clickCreate();
        await waitFor(() => expect(repeats()).toHaveAttribute('aria-invalid', 'true'));
    });

    it('saves an occurrence alone or with the following ones', async () => {
        const patches: Record<string, unknown>[] = [];
        server.use(previewHandler, http.patch(`${API}/tasks/chore/`, async ({ request }) => {
            patches.push((await request.json()) as Record<string, unknown>);
            return HttpResponse.json(occurrence);
        }));
        render(<TaskFormDialog open onClose={() => { }} task={occurrence} />, { wrapper });
        expect(screen.getByText(/this occurrence:/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /split into subtasks/i })).toBeNull();
        fireEvent.change(headerInput(), { target: { value: 'Water all plants' } });
        fireEvent.click(screen.getByRole('radio', { name: /this and the following/i }));
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({ header: 'Water all plants', scope: 'following' });
        expect(patches[0]).not.toHaveProperty('recurrence'); // the rule did not change
    });

    it('deletes all occurrences after asking', async () => {
        const deleted: string[] = [];
        server.use(previewHandler, http.delete(`${API}/tasks/chore/`, ({ request }) => {
            deleted.push(new URL(request.url).search);
            return new HttpResponse(null, { status: 204 });
        }));
        const onClose = vi.fn();
        render(<TaskFormDialog open onClose={onClose} task={occurrence} />, { wrapper });
        fireEvent.click(screen.getByRole('button', { name: /delete all occurrences/i }));
        expect(await screen.findByText(/all 3 occurrences of “Water plants”/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^delete all$/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(deleted).toEqual(['?occurrences=all']);
    });
});

describe('TaskFormDialog — place, markers and calendars (README: Calendar)', () => {
    const inTwoWeeks = new Date();
    inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);
    inTwoWeeks.setHours(9, 0, 0, 0);
    const conference = {
        id: 'm-conf', title: 'Conference', description: '', place: '', start: inTwoWeeks.toISOString(),
        duration: '1 00:00:00', end: inTwoWeeks.toISOString(), all_day: false, calendar: null, deadline_task_count: 0,
    };
    const appointment = {
        id: 'kickoff', header: 'Kickoff', description: 'Bring the slides', start_date: '2026-10-14T08:00:00Z',
        duration: '01:00:00', latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [],
        hex_color: null, is_fixed: false, is_appointment: true, completed_at: null, is_done: false,
        active_tracking_start: null, ...treeDefaults, place: 'Room 4.12',
        calendar: {
            id: 'link-1', name: 'Google Calendar', pending: ['header' as const],
            event: {
                header: 'Project kickoff', description: 'Bring the slides', place: 'Room 4.12',
                start: '2026-10-14T08:00:00Z', end: '2026-10-14T09:00:00Z', all_day: false,
            },
        },
    };
    const prepare = {
        ...appointment, id: 'prep', header: 'Prepare talk', is_appointment: false, start_date: null, place: '',
        calendar: null, latest_finish_date: conference.start,
        deadline_marker: { id: conference.id, title: conference.title, start: conference.start },
    };
    const markersHandler = http.get(`${API}/markers/`, () => HttpResponse.json([conference]));

    it('saves a place', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Workshop' } });
        fireEvent.change(screen.getByRole('textbox', { name: /^place$/i }), { target: { value: ' Lab 2 ' } });
        clickCreate();
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ header: 'Workshop', place: 'Lab 2' });
    });

    it('takes a marker as the deadline', async () => {
        server.use(markersHandler);
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Prepare talk' } });
        fireEvent.mouseDown(await screen.findByRole('combobox', { name: /deadline at a marker/i }));
        fireEvent.click(await screen.findByRole('option', { name: /^Conference/ }));

        expect(screen.getByText('At “Conference” — moves with it')).toBeInTheDocument();
        clickCreate();
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ deadline_marker_id: 'm-conf', latest_finish_date: conference.start });
    });

    it('lets go of the marker when the deadline gets a date of its own', async () => {
        const patches: Record<string, unknown>[] = [];
        server.use(markersHandler, http.patch(`${API}/tasks/prep/`, async ({ request }) => {
            patches.push((await request.json()) as Record<string, unknown>);
            return HttpResponse.json(prepare);
        }));
        render(<TaskFormDialog open onClose={() => { }} task={prepare} />, { wrapper });
        expect(await screen.findByText('At “Conference” — moves with it')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^deadline$/i), { target: { value: '2030-01-10T12:00' } });
        expect(screen.queryByText(/moves with it/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({
            deadline_marker_id: null, latest_finish_date: new Date('2030-01-10T12:00').toISOString(),
        });
    });

    it('says what the calendar changed and compares it with the task', async () => {
        render(<TaskFormDialog open onClose={() => { }} task={appointment} />, { wrapper });
        expect(screen.getByText('Google Calendar changed the title; yours is kept.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

        expect(await screen.findByText('Compare “Kickoff” with Google Calendar')).toBeInTheDocument();
        expect((screen.getByLabelText('merged Title') as HTMLInputElement).value).toBe('Kickoff');
    });
});

describe('TaskFormDialog — tracked time (README: Time sheet)', () => {
    const task = {
        id: 'report', header: 'Report', description: '', start_date: null, duration: '04:00:00',
        latest_finish_date: null, time_spent: '01:30:00', priority: 5, tags: [], hex_color: null,
        is_fixed: false, is_appointment: false, completed_at: null, is_done: false, active_tracking_start: null,
        ...treeDefaults,
    };

    it('opens the task’s tracked time to correct it', async () => {
        const queries: string[] = [];
        server.use(http.get(`${API}/sessions/`, ({ request }) => {
            queries.push(new URL(request.url).search);
            return HttpResponse.json([]);
        }));
        render(<TaskFormDialog open onClose={() => { }} task={task} />, { wrapper });
        expect(screen.getByText(/Spent 1h 30m of 4h/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Tracked time' }));

        expect(await screen.findByRole('dialog', { name: 'Tracked time of “Report”' })).toBeInTheDocument();
        await waitFor(() => expect(queries).toEqual(['?task=report']));
    });

    it('offers to add tracked time to a task without any', () => {
        render(<TaskFormDialog open onClose={() => { }} task={{ ...task, time_spent: '00:00:00' }} />, { wrapper });
        expect(screen.getByRole('button', { name: 'Add tracked time' })).toBeInTheDocument();
    });

    it('is not offered for a new task', () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        expect(screen.queryByRole('button', { name: /tracked time/i })).toBeNull();
    });
});

describe('TaskFormDialog — a repeating calendar event (README: Calendar)', () => {
    const event = { header: 'Team call', description: '', place: 'Room 4', start: '2026-10-13T08:00:00Z',
        end: '2026-10-13T09:00:00Z', all_day: false };
    const member = {
        id: 'call', header: 'Team call', description: '', start_date: '2026-10-13T08:00:00Z', duration: '01:00:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 5, tags: [], hex_color: null, is_fixed: false,
        is_appointment: true, completed_at: null, is_done: false, active_tracking_start: null, ...treeDefaults,
        recurrence: 'every tuesday at 10:00', recurrence_description: 'every Tuesday at 10:00', series_id: 's1',
        occurrence: '2026-10-13T08:00:00Z', occurrence_count: 8,
        calendar: { id: 'link-1', name: 'Google', event, pending: [] },
        series_calendar: { name: 'Google', auto: true, mismatch: '' },
    };
    const previewHandler = http.post(`${API}/recurrence-preview/`, () => HttpResponse.json({
        description: 'every Wednesday at 10:00', occurrences: ['2026-10-28T09:00:00Z'],
    }));
    const patching = (patches: Record<string, unknown>[]) => http.patch(`${API}/tasks/:id/`, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(member);
    });

    it('switches off including new occurrences without asking', async () => {
        const patches: Record<string, unknown>[] = [];
        server.use(previewHandler, patching(patches));
        render(<TaskFormDialog open onClose={() => { }} task={member} />, { wrapper });

        const toggle = screen.getByRole('switch', { name: 'Include new occurrences from Google without asking' });
        expect(toggle).toBeChecked();
        expect(screen.getByText(/join this recurring task by themselves/)).toBeInTheDocument();
        fireEvent.click(toggle);
        expect(screen.getByText('New occurrences come as tasks of their own.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({ calendar_auto: false });
        expect(patches[0]).not.toHaveProperty('recurrence');
    });

    it('shows why an occurrence did not fit; a rule that fits includes it again', async () => {
        const patches: Record<string, unknown>[] = [];
        server.use(previewHandler, patching(patches));
        const loose = {
            ...member, id: 'loose', series_id: null, occurrence: null, occurrence_count: 0,
            series_calendar: { name: 'Google', auto: false,
                mismatch: 'Google has “Team call” on Wed 28/10 10:00, which “every tuesday at 10:00” does not have.' },
        };
        render(<TaskFormDialog open onClose={() => { }} task={loose} />, { wrapper });

        expect(screen.getByText(/which “every tuesday at 10:00” does not have/)).toBeInTheDocument();
        expect(screen.getByText(/is not part of the recurring task/)).toBeInTheDocument();
        const toggle = screen.getByRole('switch', { name: /include new occurrences/i });
        expect(toggle).not.toBeChecked();

        fireEvent.change(screen.getByRole('textbox', { name: /repeats/i }), { target: { value: 'every wednesday at 10:00' } });
        expect(toggle).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({ recurrence: 'every wednesday at 10:00', calendar_auto: true });
    });

    it('says that deleting all occurrences keeps later ones away', async () => {
        server.use(previewHandler);
        render(<TaskFormDialog open onClose={() => { }} task={member} />, { wrapper });
        fireEvent.click(screen.getByRole('button', { name: /delete all occurrences/i }));
        expect(await screen.findByText(/Later ones from Google do not come either/)).toBeInTheDocument();
    });
});
