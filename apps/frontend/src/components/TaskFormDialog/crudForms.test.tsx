/**
 * WP-12 tests: the CRUD forms.
 *
 * - happy path: create tag -> task (using that tag) -> bucket type
 * - recurrence preview shows server-parsed dates; parser errors surface
 * - appointment toggle reveals the start field and posts is_appointment
 * - edit mode PATCHes the existing task
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { OutlineView } from '../OutlineView/OutlineView.tsx';
import TagList from '../TagList/TagList.tsx';
import BucketTypeList from '../BucketTypeList/BucketTypeList.tsx';
import { TaskFormDialog } from './TaskFormDialog.tsx';
import { BucketTypeFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';
import type { Tag, Task } from '../../types.ts';
import { calendarHandlers } from '../../testing/calendarHandlers.ts';

const API = 'http://localhost:8000/api';

let tags: Tag[] = [];
let created: Record<string, unknown[]> = { tags: [], tasks: [], buckettypes: [] };
let patched: Record<string, unknown>[] = [];

const server = setupServer(
    ...calendarHandlers(),
    http.get(`${API}/tasks/`, () => HttpResponse.json([] as Task[])),
    http.get(`${API}/tags/`, () => HttpResponse.json(tags)),
    http.get(`${API}/buckettypes/`, () => HttpResponse.json([])),
    http.get(`${API}/settings/`, () => HttpResponse.json({
        default_duration: '01:00:00', active_task_id: null, active_task_path: [], time_zone: '',
    })),
    http.post(`${API}/tags/`, async ({ request }) => {
        const body = (await request.json()) as { name: string; hex_color: string };
        const tag = { id: `tag-${tags.length + 1}`, name: body.name, hex_color: body.hex_color };
        tags = [...tags, tag];
        created.tags.push(body);
        return HttpResponse.json(tag, { status: 201 });
    }),
    http.post(`${API}/tasks/`, async ({ request }) => {
        const body = await request.json();
        created.tasks.push(body);
        return HttpResponse.json({ id: 'task-new', ...(body as object) }, { status: 201 });
    }),
    http.post(`${API}/buckettypes/`, async ({ request }) => {
        const body = await request.json();
        created.buckettypes.push(body);
        return HttpResponse.json({ id: 1, ...(body as object) }, { status: 201 });
    }),
    http.post(`${API}/recurrence-preview/`, async ({ request }) => {
        const { start_times } = (await request.json()) as { start_times: string };
        if (start_times === 'every weekday at 09:00') {
            return HttpResponse.json({
                description: 'every weekday at 09:00',
                occurrences: [
                    '2026-07-08T09:00:00+02:00', '2026-07-09T09:00:00+02:00',
                    '2026-07-10T09:00:00+02:00', '2026-07-13T09:00:00+02:00',
                    '2026-07-14T09:00:00+02:00',
                ],
            });
        }
        return HttpResponse.json(
            { detail: `“${start_times}” is not a recognizable recurrence rule.` },
            { status: 400 },
        );
    }),
    http.patch(`${API}/tasks/task-7/`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patched.push(body);
        return HttpResponse.json({ id: 'task-7', ...body });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    tags = [];
    created = { tags: [], tasks: [], buckettypes: [] };
    patched = [];
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('CRUD happy path: tag -> task -> bucket type', () => {
    it('creates all three through their dedicated panes', async () => {
        // 1. Tag — from the Tags pane
        const tagPane = render(<TagList />, { wrapper });
        fireEvent.click(await screen.findByRole('button', { name: /add tag/i }));
        const tagDialog = await screen.findByRole('dialog');
        fireEvent.change(within(tagDialog).getByLabelText(/name/i), {
            target: { value: 'deep-work' },
        });
        fireEvent.click(within(tagDialog).getByRole('button', { name: /create/i }));
        await waitFor(() => expect(created.tags).toHaveLength(1));
        expect(created.tags[0]).toMatchObject({ name: 'deep-work' });
        tagPane.unmount();

        // 2. Task using the fresh tag — "+ New task" in the Tasks tab (T-2)
        const taskPane = render(<OutlineView />, { wrapper });
        fireEvent.click(await screen.findByRole('button', { name: /new task/i }));
        const taskDialog = await screen.findByRole('dialog');
        fireEvent.change(within(taskDialog).getByLabelText(/header/i), {
            target: { value: 'Design Schema' },
        });
        fireEvent.mouseDown(within(taskDialog).getByLabelText(/tags/i));
        fireEvent.click(await screen.findByRole('option', { name: /deep-work/i }));
        fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
        fireEvent.click(within(taskDialog).getByRole('button', { name: /create/i }));
        await waitFor(() => expect(created.tasks).toHaveLength(1));
        expect(created.tasks[0]).toMatchObject({
            header: 'Design Schema', tag_ids: ['tag-1'],
        });
        taskPane.unmount();

        // 3. Bucket type with live preview — from the Time Buckets pane
        render(<BucketTypeList />, { wrapper });
        fireEvent.click(await screen.findByRole('button', { name: /add bucket/i }));
        const bucketDialog = await screen.findByRole('dialog');
        fireEvent.change(within(bucketDialog).getByLabelText(/name/i), {
            target: { value: 'Morning Focus' },
        });
        fireEvent.change(within(bucketDialog).getByLabelText(/recurrence/i), {
            target: { value: 'every weekday at 09:00' },
        });
        await waitFor(() =>
            expect(within(bucketDialog).getAllByTestId('preview-occurrence')).toHaveLength(5),
        );
        fireEvent.click(within(bucketDialog).getByRole('button', { name: /create/i }));
        await waitFor(() => expect(created.buckettypes).toHaveLength(1));
        expect(created.buckettypes[0]).toMatchObject({
            name: 'Morning Focus', start_times: 'every weekday at 09:00',
        });
    });
});

describe('BucketTypeFormDialog recurrence preview', () => {
    it('shows the parser error for an invalid rule', async () => {
        render(<BucketTypeFormDialog open onClose={() => { }} />, { wrapper });

        fireEvent.change(screen.getByLabelText(/recurrence/i), {
            target: { value: 'blorp glorp' },
        });

        await waitFor(() =>
            expect(screen.getByText(/not a recognizable recurrence rule/i)).toBeInTheDocument(),
        );
        expect(screen.queryAllByTestId('preview-occurrence')).toHaveLength(0);
    });

    it('clears the preview and the error when the rule is emptied', async () => {
        render(<BucketTypeFormDialog open onClose={() => { }} />, { wrapper });
        const rule = screen.getByLabelText(/recurrence/i);

        fireEvent.change(rule, { target: { value: 'every weekday at 09:00' } });
        await waitFor(() => expect(screen.getAllByTestId('preview-occurrence')).toHaveLength(5));
        fireEvent.change(rule, { target: { value: '' } });
        expect(screen.queryAllByTestId('preview-occurrence')).toHaveLength(0);

        fireEvent.change(rule, { target: { value: 'blorp glorp' } });
        await screen.findByText(/not a recognizable recurrence rule/i);
        fireEvent.change(rule, { target: { value: '  ' } });
        expect(screen.queryByText(/not a recognizable recurrence rule/i)).not.toBeInTheDocument();
    });

    it('shows no stale preview when reopened after creating', async () => {
        const view = render(<BucketTypeFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Morning Focus' } });
        fireEvent.change(screen.getByLabelText(/recurrence/i), {
            target: { value: 'every weekday at 09:00' },
        });
        await waitFor(() => expect(screen.getAllByTestId('preview-occurrence')).toHaveLength(5));
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => expect(created.buckettypes).toHaveLength(1));

        view.rerender(<BucketTypeFormDialog open={false} onClose={() => { }} />);
        view.rerender(<BucketTypeFormDialog open onClose={() => { }} />);
        expect(await screen.findByLabelText(/recurrence/i)).toHaveValue('');
        expect(screen.queryAllByTestId('preview-occurrence')).toHaveLength(0);
    });
});

describe('BucketTypeFormDialog colors (§4.4)', () => {
    it('creates a bucket type with a chosen color', async () => {
        render(<BucketTypeFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Mornings' } });
        fireEvent.change(screen.getByLabelText(/recurrence/i), { target: { value: 'every weekday at 09:00' } });
        expect(screen.getByRole('button', { name: /automatic/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText(/unlike the other time buckets/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => expect(created.buckettypes).toHaveLength(1));
        expect(created.buckettypes[0]).toMatchObject({ own_hex_color: '#477ed8' });
    });

    it('previews an existing type\'s automatic color and goes back to it', async () => {
        const patches: unknown[] = [];
        server.use(http.patch(`${API}/buckettypes/7/`, async ({ request }) => {
            patches.push(await request.json());
            return HttpResponse.json({ id: 7 });
        }));
        const mornings = {
            id: 7, name: 'Mornings', start_times: 'every weekday at 09:00', duration: '04:00:00', tags: [],
            hex_color: '#3357ff', own_hex_color: '#3357ff', auto_hex_color: '#299fcd',
        };
        render(<BucketTypeFormDialog open onClose={() => { }} bucketType={mornings} />, { wrapper });
        expect(screen.getByTestId('custom-swatch')).toHaveStyle({ backgroundColor: '#3357ff' });
        expect(screen.getByTestId('default-swatch')).toHaveStyle({ backgroundColor: '#299fcd' });
        fireEvent.click(screen.getByRole('button', { name: /automatic/i }));
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toMatchObject({ own_hex_color: null });
    });
});

describe('TaskFormDialog', () => {
    it('reveals the start field with the appointment toggle and posts it', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });

        expect(screen.queryByLabelText(/start/i)).toBeNull();
        fireEvent.click(screen.getByRole('checkbox', { name: /appointment/i }));
        fireEvent.change(screen.getByLabelText(/header/i), {
            target: { value: 'Team Sync' },
        });
        fireEvent.change(screen.getByLabelText(/start/i), {
            target: { value: '2026-07-09T10:00' },
        });
        // An appointment needs a duration (a normal task may leave it empty).
        fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(created.tasks).toHaveLength(1));
        expect(created.tasks[0]).toMatchObject({ is_appointment: true, header: 'Team Sync' });
        // The input is local time; compare instants, not the UTC date string.
        expect(new Date((created.tasks[0] as { start_date: string }).start_date).getTime())
            .toBe(new Date('2026-07-09T10:00').getTime());
    });

    it('edit mode prefills and PATCHes the task', async () => {
        const existing: Partial<Task> = {
            id: 'task-7', header: 'Old header', description: 'desc',
            duration: '02:00:00', priority: 7, tags: [], is_appointment: false,
            start_date: null, latest_finish_date: null,
        };
        render(
            <TaskFormDialog open onClose={() => { }} task={existing as Task} />,
            { wrapper },
        );

        const header = screen.getByRole('textbox', { name: /^header$/i }) as HTMLInputElement;
        expect(header.value).toBe('Old header');
        fireEvent.change(header, { target: { value: 'New header' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(patched).toHaveLength(1));
        expect(patched[0]).toMatchObject({ header: 'New header' });
    });
});
