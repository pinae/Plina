import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useIsMobile, useIsShort, useIsTouch } from './useResponsive.ts';
import { fakeScreen, PHONE } from '../testing/matchMedia.ts';

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

describe('useIsMobile / useIsTouch', () => {
    it('are false on a desktop (and in jsdom without matchMedia)', () => {
        expect(renderHook(() => useIsMobile()).result.current).toBe(false);
        expect(renderHook(() => useIsTouch()).result.current).toBe(false);
    });

    it('recognize a phone: narrow and touch', () => {
        restore = fakeScreen(PHONE);
        expect(renderHook(() => useIsMobile()).result.current).toBe(true);
        expect(renderHook(() => useIsTouch()).result.current).toBe(true);
    });

    it('treat 600 px as the last phone width (spec §3: ≤ 600 px)', () => {
        restore = fakeScreen({ width: 600 });
        expect(renderHook(() => useIsMobile()).result.current).toBe(true);
        restore();
        restore = fakeScreen({ width: 601 });
        expect(renderHook(() => useIsMobile()).result.current).toBe(false);
    });

    it('a wide touch screen (tablet) is touch but not mobile', () => {
        restore = fakeScreen({ width: 1024, touch: true });
        expect(renderHook(() => useIsMobile()).result.current).toBe(false);
        expect(renderHook(() => useIsTouch()).result.current).toBe(true);
    });
});

describe('useIsShort: the header scrolls away (README: Week view on small screens)', () => {
    it('is true on phones and on screens under 800 px high', () => {
        restore = fakeScreen(PHONE);
        expect(renderHook(() => useIsShort()).result.current).toBe(true);
        restore();
        restore = fakeScreen({ width: 1366, height: 700 });
        expect(renderHook(() => useIsShort()).result.current).toBe(true);
    });

    it('is false on high screens (and in jsdom without matchMedia)', () => {
        expect(renderHook(() => useIsShort()).result.current).toBe(false);
        restore = fakeScreen({ width: 1366, height: 800 });
        expect(renderHook(() => useIsShort()).result.current).toBe(false);
    });
});
