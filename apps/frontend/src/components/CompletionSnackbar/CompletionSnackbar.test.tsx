import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CompletionSnackbar } from './CompletionSnackbar.tsx';
import { API } from '../../testing/treeFixtures.ts';

const reopened: string[] = [];
const server = setupServer(
    http.post(`${API}/tasks/:id/reopen/`, ({ params }) => {
        reopened.push(String(params.id));
        return HttpResponse.json({ task: { id: params.id }, reopened: [params.id] });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { cleanup(); reopened.length = 0; });
afterAll(() => server.close());

const renderSnackbar = (completed: { id: string; header: string }[] | null, onClose = vi.fn()) => {
    render(<QueryClientProvider client={new QueryClient()}>
        <CompletionSnackbar autoCompleted={completed} onClose={onClose} />
    </QueryClientProvider>);
    return onClose;
};

describe('CompletionSnackbar', () => {
    it('names the topmost auto-completed task and undoes the whole cascade', async () => {
        const onClose = renderSnackbar([{ id: 'hw', header: 'Hardware Design' }, { id: 't250', header: 'T250' }]);
        expect(screen.getByText('“T250” completed too')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /undo/i }));
        // Reopening the lowest one reopens its completed ancestors as well.
        await waitFor(() => expect(reopened).toEqual(['hw']));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('stays hidden without auto-completed parents', () => {
        renderSnackbar(null);
        expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    });
});
