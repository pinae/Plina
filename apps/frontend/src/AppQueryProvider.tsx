/** The app-wide TanStack Query client and its provider. Kept apart from
 *  queries.tsx so that file exports only hooks (React fast refresh needs a
 *  module to export either components or other values, not both). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const appQueryClient = new QueryClient({
    defaultOptions: {
        queries: { staleTime: 10_000, refetchOnWindowFocus: false },
    },
});

export function AppQueryProvider({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={appQueryClient}>
            {children}
        </QueryClientProvider>
    );
}
