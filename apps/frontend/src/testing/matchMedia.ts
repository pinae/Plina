/** jsdom has no matchMedia, so MUI's useMediaQuery reports "no match" and
 *  components render their desktop layout. Tests of the phone layout (UI-9)
 *  install a fake that answers the queries of hooks/useResponsive.ts. */
export interface FakeScreen {
    /** Viewport width in px (default 1280). */
    width?: number;
    /** Touch screen: `(pointer: coarse)` matches. */
    touch?: boolean;
}

function matches(query: string, { width = 1280, touch = false }: FakeScreen): boolean {
    return query.split(',').some(part => {
        const max = part.match(/max-width:\s*([\d.]+)px/);
        if (max) return width <= Number(max[1]);
        const min = part.match(/min-width:\s*([\d.]+)px/);
        if (min) return width >= Number(min[1]);
        if (part.includes('pointer: coarse')) return touch;
        if (part.includes('pointer: fine')) return !touch;
        return false;
    });
}

/** Installs the fake; returns a function that removes it again. */
export function fakeScreen(screen: FakeScreen): () => void {
    const previous = window.matchMedia;
    window.matchMedia = (query: string) => ({
        matches: matches(query, screen), media: query, onchange: null,
        addEventListener: () => { }, removeEventListener: () => { },
        addListener: () => { }, removeListener: () => { }, dispatchEvent: () => false,
    }) as MediaQueryList;
    return () => { window.matchMedia = previous; };
}

export const PHONE: FakeScreen = { width: 390, touch: true };
