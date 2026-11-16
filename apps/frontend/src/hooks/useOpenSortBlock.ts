/** Sorting a block again (docs/sort-time.md): from its id — a shared-out
 *  session's, the time sheet's "Not sorted yet" — load it and open the sheet. */
import { useCallback } from 'react';

import { fetchWorkBlock } from '../api.ts';
import { useOpenSortTime } from '../components/SortTimeDialog/sortTimeContext.ts';

export function useOpenSortBlock(): (blockId: string) => Promise<void> {
    const open = useOpenSortTime();
    return useCallback(blockId => fetchWorkBlock(blockId).then(block => open({ block })), [open]);
}
