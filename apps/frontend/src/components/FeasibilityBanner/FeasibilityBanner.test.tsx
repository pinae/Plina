import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import { FeasibilityBanner } from './FeasibilityBanner.tsx';
import { makeTask } from '../../testing/treeFixtures.ts';
import type { PlanWarning } from '../../types.ts';

function renderBanner(warnings: PlanWarning[]) {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(['tasks'], [
        makeTask('t250', { header: 'T250', children_ids: ['cad'] }),
        makeTask('cad', { header: 'CAD', parent_id: 't250', ancestor_ids: ['t250'] }),
        makeTask('milk', { header: 'Buy milk' }),
    ]);
    render(<QueryClientProvider client={client}><FeasibilityBanner warnings={warnings} /></QueryClientProvider>);
}

const warning = (task_id: string, header: string): PlanWarning => ({
    task_id, header, kind: 'deadline_missed', deadline: '2026-10-09T23:59:00Z', projected_finish: '2026-10-12T12:00:00Z',
});

describe('FeasibilityBanner', () => {
    afterEach(cleanup);

    it('names the project (the top-level task) of the late task', () => {
        renderBanner([warning('cad', 'CAD')]);
        expect(screen.getByText(/Project “T250” \(task “CAD”\) can't finish by Oct 9/)).toBeInTheDocument();
    });

    it('names just the task when it is a project of its own', () => {
        renderBanner([warning('milk', 'Buy milk')]);
        expect(screen.getByText(/^“Buy milk” can't finish by/)).toBeInTheDocument();
    });

    it('offers the three remedies', () => {
        renderBanner([warning('cad', 'CAD')]);
        expect(screen.getByRole('button', { name: /add time buckets/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /edit deadline/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /edit priority/i })).toBeInTheDocument();
    });
});
