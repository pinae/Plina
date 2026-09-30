import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { WhatNextDialog } from './WhatNextDialog.tsx';
import { API, makeAlternative } from '../../testing/treeFixtures.ts';
import { fakeScreen, PHONE } from '../../testing/matchMedia.ts';

const accepted: string[] = [];
const reopened: string[] = [];
const server = setupServer(
    http.post(`${API}/tasks/:id/reopen/`, ({ params }) => {
        reopened.push(String(params.id));
        return HttpResponse.json({ task: {}, reopened: [params.id] });
    }),
    http.post(`${API}/plans/:id/accept/`, ({ params }) => {
        accepted.push(String(params.id));
        return HttpResponse.json({ id: params.id, is_accepted: true });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { cleanup(); accepted.length = 0; reopened.length = 0; });
afterAll(() => server.close());

const renderDialog = (onClose = vi.fn()) => render(
    <QueryClientProvider client={new QueryClient()}>
        <WhatNextDialog
            alternatives={[makeAlternative('a', 'Continue T250'), makeAlternative('b', 'Switch to the blog')]}
            onClose={onClose}
        />
    </QueryClientProvider>,
);

describe('WhatNextDialog', () => {
    it('offers the alternatives and accepts the chosen one', async () => {
        const onClose = vi.fn();
        renderDialog(onClose);
        expect(screen.getByText('Nice! What next?')).toBeInTheDocument();
        expect(screen.getByText('Switch to the blog')).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: /choose/i })[1]);
        await waitFor(() => expect(accepted).toEqual(['b']));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('is closed without alternatives', () => {
        render(
            <QueryClientProvider client={new QueryClient()}>
                <WhatNextDialog alternatives={null} onClose={vi.fn()} />
            </QueryClientProvider>,
        );
        expect(screen.queryByText('Nice! What next?')).toBeNull();
    });

    it('carries the completion undo when parents completed too (UI-8)', async () => {
        // The modal hides the page from assistive tech, so a snackbar behind it
        // would be unreachable by keyboard: the dialog offers Undo itself.
        const onClose = vi.fn();
        render(
            <QueryClientProvider client={new QueryClient()}>
                <WhatNextDialog
                    alternatives={[makeAlternative('a', 'Continue T250')]}
                    autoCompleted={[{ id: 'hw', header: 'Hardware Design' }, { id: 't250', header: 'T250' }]}
                    onClose={onClose}
                />
            </QueryClientProvider>,
        );
        expect(screen.getByText('“T250” completed too')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(reopened).toEqual(['hw']));
        // The alternatives were computed without the reopened tasks: stale.
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('fills the screen on a phone (UI-9)', () => {
        const restore = fakeScreen(PHONE);
        try {
            renderDialog();
            expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperFullScreen');
        } finally {
            restore();
        }
    });
});

