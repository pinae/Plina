import '@testing-library/jest-dom';
import { afterEach } from 'vitest';

// --- Fail on React act() warnings ------------------------------------------
// "An update to X inside a test was not wrapped in act(...)" means a test
// changed state behind React Testing Library's back (e.g. a direct
// element.focus()), so its assertions may not see what a user would. Turn
// the warning into a failure of the test that caused it instead of noise.
const actWarnings: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.includes('not wrapped in act(')) actWarnings.push(text.split('\n')[0]);
    originalConsoleError(...args);
};
afterEach(() => {
    if (actWarnings.length === 0) return;
    const found = actWarnings.splice(0);
    throw new Error(
        `React act() warning(s) in this test:\n${found.join('\n')}\n` +
        'Wrap direct DOM calls such as element.focus() in act(), or use fireEvent.',
    );
});

// --- React Flow in jsdom -----------------------------------------------
// @xyflow/react measures its viewport; jsdom provides neither ResizeObserver
// nor DOMMatrixReadOnly nor element sizes.  These are the mocks recommended
// by the React Flow testing guide.
class ResizeObserverMock {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }
    // Initial measurement flows through the offsetWidth/offsetHeight mocks
    // below; firing the callback here confuses @xyflow/system's pan-zoom
    // observer, which expects real ResizeObserverEntry objects.
    observe() { }
    unobserve() { }
    disconnect() { }
}

class DOMMatrixReadOnlyMock {
    m22: number;
    constructor(transform?: string) {
        const scale = transform?.match(/scale\(([1-9.]+)\)/)?.[1];
        this.m22 = scale !== undefined ? +scale : 1;
    }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}
if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;
}
Object.defineProperties(globalThis.HTMLElement.prototype, {
    offsetHeight: { get() { return parseFloat(this.style.height) || 600; } },
    offsetWidth: { get() { return parseFloat(this.style.width) || 800; } },
});
(globalThis.SVGElement.prototype as unknown as { getBBox: () => object }).getBBox =
    () => ({ x: 0, y: 0, width: 0, height: 0 });
