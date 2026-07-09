import '@testing-library/jest-dom';

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
