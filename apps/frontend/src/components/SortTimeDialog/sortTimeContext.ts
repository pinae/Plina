/** Opening the sort sheet (docs/sort-time.md) from anywhere: the tracker,
 *  the time sheet. ``SortTimeProvider`` (SortTimeDialog.tsx) answers it. */
import { createContext, useContext } from 'react';

import type { TrackedSession, WorkBlock } from '../../types.ts';

/** What to sort: a block (begun with "Start work", or sorted already), a session, a gap. */
export type SortTarget = { block: WorkBlock } | { session: TrackedSession } | { gap: { start: string; end: string } };

export const SortTimeContext = createContext<(target: SortTarget) => void>(() => undefined);

/** Opens the sort sheet. */
export const useOpenSortTime = () => useContext(SortTimeContext);
