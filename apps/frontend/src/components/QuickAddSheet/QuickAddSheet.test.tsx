import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { QuickAddSheet } from './QuickAddSheet.tsx';
import { API, makerTag, settingsFor, treeTasks } from '../../testing/treeFixtures.ts';

const server = setupServer(
    http.get(`${API}/tasks/`, () => HttpResponse.json(treeTasks())),
    http.get(`${API}/tags/`, () => HttpResponse.json([makerTag])),
    http.get(`${API}/settings/`, () => HttpResponse.json(settingsFor(treeTasks(), 'hw'))),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

function Harness() {
    const [open, setOpen] = useState(false);
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return <QueryClientProvider client={client}><QuickAddSheet open={open} onOpenChange={setOpen} /></QueryClientProvider>;
}

describe('QuickAddSheet (phones, UI-9)', () => {
    it('opens from the ⊕ button with the input focused (spec §3: floating add button)', async () => {
        render(<Harness />);
        expect(screen.queryByRole('textbox', { name: /add task/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'add task' }));

        const sheet = await screen.findByRole('dialog', { name: 'Add task' });
        expect(within(sheet).getByRole('textbox', { name: /add task/i })).toHaveFocus();
        // The chips wait for the data, then offer the active project.
        await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Hardware Design' }))
            .toHaveAttribute('aria-pressed', 'true'));
        // ⊕ is hidden while the sheet is open.
        expect(screen.queryByRole('button', { name: 'add task' })).toBeNull();
    });

    it('closes with its close button and brings ⊕ back', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'add task' }));
        const sheet = await screen.findByRole('dialog', { name: 'Add task' });
        await waitFor(() => expect(within(sheet).getByTestId('quick-add-project')).not.toHaveTextContent('Loading'));
        fireEvent.click(within(sheet).getByRole('button', { name: 'close' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add task' })).toBeNull());
        expect(screen.getByRole('button', { name: 'add task' })).toBeInTheDocument();
    });
});
