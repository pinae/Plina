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
import type { ReactNode } from 'react';

import { TaskFormDialog } from './TaskFormDialog.tsx';

const API = 'http://localhost:8000/api';
let posted: Record<string, unknown>[] = [];

const server = setupServer(
    http.get(`${API}/tags/`, () => HttpResponse.json([])),
    http.get(`${API}/projects/`, () => HttpResponse.json([])),
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

    it('explains an empty duration differently from a malformatted one', async () => {
        render(<TaskFormDialog open onClose={() => { }} />, { wrapper });
        fireEvent.change(headerInput(), { target: { value: 'Report' } });

        fireEvent.change(durationInput(), { target: { value: '' } });
        clickCreate();
        expect(await screen.findByText(/duration is empty/i)).toBeInTheDocument();

        fireEvent.change(durationInput(), { target: { value: 'two hours' } });
        expect(await screen.findByText(/“two hours” is not a valid duration/)).toBeInTheDocument();
        expect(screen.queryByText(/duration is empty/i)).toBeNull();
        expect(durationInput()).toHaveAttribute('aria-invalid', 'true');
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
