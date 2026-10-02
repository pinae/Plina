/**
 * UI-9: layout switches for phones (docs/task-entry-ui.md §7).
 *
 * - ``useIsMobile``: viewport ≤ 600 px — compact header, quick-add sheet.
 * - ``useIsTouch``: coarse pointer — no hover, so actions that live on keys
 *   (indent/outdent …) get buttons; also true on tablets.
 *
 * Both are false without ``matchMedia`` (jsdom): tests see the desktop unless
 * they install ``testing/matchMedia.ts``.
 */
import { useMediaQuery } from '@mui/material';

export const MOBILE_QUERY = '(max-width:600px)';
export const TOUCH_QUERY = '(pointer: coarse)';

// noSsr: read the real value on the first render instead of flashing the
// desktop layout on phones.
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY, { noSsr: true });
export const useIsTouch = () => useMediaQuery(TOUCH_QUERY, { noSsr: true });
