/**
 * WP-9: editing behavior for the dependency graph.
 *
 * Exposes React Flow-compatible handlers plus the UI state they produce:
 * the server-reported cycle path (for red highlighting) and a toast message.
 * The optimistic insert/rollback itself lives in useCreateDependency.
 */
import { useCallback, useState } from 'react';
import type { Connection, Edge } from '@xyflow/react';

import { useCreateDependency, useDeleteDependency } from '../queries';

export function useDependencyEditing() {
    const create = useCreateDependency();
    const remove = useDeleteDependency();
    const [cyclePath, setCyclePath] = useState<string[] | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const onConnect = useCallback((connection: Connection) => {
        const { source, target } = connection;
        if (!source || !target || source === target) return;
        setCyclePath(null);
        create.mutate(
            { predecessor: source, successor: target },
            {
                onError: error => {
                    const payload = error.response?.data;
                    setCyclePath(payload?.cycle ?? null);
                    setToast(payload?.detail ?? 'Could not create the dependency.');
                },
            },
        );
    }, [create]);

    const onEdgesDelete = useCallback((edges: Pick<Edge, 'id' | 'source' | 'target'>[]) => {
        for (const edge of edges) {
            if (edge.id.startsWith('optimistic-')) continue;
            remove.mutate(edge.id, {
                onError: () => setToast('Could not delete the dependency.'),
            });
        }
    }, [remove]);

    const clearToast = useCallback(() => setToast(null), []);
    const clearCycle = useCallback(() => setCyclePath(null), []);

    return { onConnect, onEdgesDelete, cyclePath, toast, clearToast, clearCycle };
}
