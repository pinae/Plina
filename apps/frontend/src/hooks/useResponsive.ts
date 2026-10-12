/**
 * UI-9: layout switches for phones (docs/task-entry-ui.md §7).
 *
 * - ``useIsMobile``: viewport ≤ 600 px — compact header, quick-add sheet.
 * - ``useIsNarrow``: viewport below 900 px (phones included) — the Tasks tab
 *   gives its titles the room: colored titles instead of dots, no tags.
 * - ``useIsTouch``: coarse pointer — no hover, so actions that live on keys
 *   (indent/outdent …) get buttons; also true on tablets.
 * - ``useIsShort``: a phone or a screen under 800 px high — the Week tab
 *   scrolls as a page, so its header scrolls away and the week gets the whole
 *   screen height (README: Week view on small screens).
 *
 * Both are false without ``matchMedia`` (jsdom): tests see the desktop unless
 * they install ``testing/matchMedia.ts``.
 */
import { useMediaQuery } from '@mui/material';

export const MOBILE_QUERY = '(max-width:600px)';
export const NARROW_QUERY = '(max-width:899.95px)';
export const TOUCH_QUERY = '(pointer: coarse)';
export const SHORT_QUERY = '(max-height: 799.95px), (max-width: 600px)';

// noSsr: read the real value on the first render instead of flashing the
// desktop layout on phones.
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY, { noSsr: true });
export const useIsNarrow = () => useMediaQuery(NARROW_QUERY, { noSsr: true });
export const useIsTouch = () => useMediaQuery(TOUCH_QUERY, { noSsr: true });
export const useIsShort = () => useMediaQuery(SHORT_QUERY, { noSsr: true });
