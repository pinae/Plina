import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary.tsx';

function Bomb(): never {
    throw new Error('project.order is not iterable');
}

describe('ErrorBoundary', () => {
    it('shows a visible error instead of a blank page when a child crashes', () => {
        // React logs the error loudly; keep the test output clean.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>,
        );
        spy.mockRestore();

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText(/project\.order is not iterable/)).toBeInTheDocument();
    });

    it('renders children normally when nothing throws', () => {
        render(<ErrorBoundary><p>all fine</p></ErrorBoundary>);
        expect(screen.getByText('all fine')).toBeInTheDocument();
    });
});
