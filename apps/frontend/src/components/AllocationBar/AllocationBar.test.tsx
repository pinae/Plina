import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AllocationBar } from './AllocationBar.tsx';
import type { Allocation } from '../../utils/splitMath.ts';

const allocation = (segments: Allocation['segments']): Allocation => ({
    segments, available: 0, partsTotal: 0, unassigned: 0, overBy: 0,
});

describe('AllocationBar', () => {
    afterEach(cleanup);

    it('draws one segment per part, sized by its share', () => {
        render(<AllocationBar allocation={allocation([
            { kind: 'explicit', minutes: 180, label: 'CAD' },
            { kind: 'ghost', minutes: 120, label: 'prints' },
            { kind: 'unassigned', minutes: 60 },
        ])} />);
        expect(screen.getByTestId('segment-explicit')).toHaveStyle({ width: '50%' });
        expect(screen.getByTestId('segment-explicit')).toHaveTextContent('CAD 3h');
        expect(screen.getByTestId('segment-ghost')).toHaveTextContent('prints ~2h');
        expect(screen.getByTestId('segment-unassigned')).toHaveTextContent('1h');
    });

    it('shows spent time and the overflow', () => {
        render(<AllocationBar allocation={allocation([
            { kind: 'spent', minutes: 60 }, { kind: 'explicit', minutes: 240, label: 'a' },
            { kind: 'over', minutes: 105 },
        ])} />);
        expect(screen.getByTestId('segment-spent')).toBeInTheDocument();
        expect(screen.getByTestId('segment-over')).toHaveTextContent('1h 45m');
    });
});
