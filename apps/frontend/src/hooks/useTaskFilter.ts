/**
 * The task filter (README: Filtering tasks), shared by the Tasks tab and the
 * dependency editor: remembered per browser, so switching tabs keeps it.
 */
import { useCallback, useState } from 'react';

import { readFilter, storeFilter, type TaskFilter } from '../utils/taskFilter.ts';

export function useTaskFilter(): [TaskFilter, (next: TaskFilter) => void] {
    const [filter, setFilter] = useState<TaskFilter>(readFilter);
    const change = useCallback((next: TaskFilter) => {
        setFilter(next);
        storeFilter(next);
    }, []);
    return [filter, change];
}
