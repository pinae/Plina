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

// Built from local time (like real deadlines: local 23:59), so the banner's
// local formatting shows Oct 9 in every timezone.
const warning = (task_id: string, header: string): PlanWarning => ({
    task_id, header, kind: 'deadline_missed',
    deadline: new Date(2026, 9, 9, 23, 59).toISOString(),
    projected_finish: new Date(2026, 9, 12, 12, 0).toISOString(),
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

    it('says how much of a task without a deadline finds no place, and why; no deadline to edit', () => {
        renderBanner([{
            task_id: 'cad', header: 'CAD', kind: 'unplanned_within_horizon', deadline: null, projected_finish: null,
            missing_minutes: 90, waits_for: null, only_tags: [],
        }]);
        expect(screen.getByText('Project “T250” (task “CAD”): 1h 30m of it find no place in the time buckets '
            + 'of the next 60 days: they are full.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /edit deadline/i })).toBeNull();
        expect(screen.getByRole('button', { name: /edit priority/i })).toBeInTheDocument();
    });
});
