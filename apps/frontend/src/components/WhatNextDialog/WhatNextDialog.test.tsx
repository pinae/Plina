import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { WhatNextDialog } from './WhatNextDialog.tsx';
import { API, makeAlternative } from '../../testing/treeFixtures.ts';

const accepted: string[] = [];
const server = setupServer(
    http.post(`${API}/plans/:id/accept/`, ({ params }) => {
        accepted.push(String(params.id));
        return HttpResponse.json({ id: params.id, is_accepted: true });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { cleanup(); accepted.length = 0; });
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
});
