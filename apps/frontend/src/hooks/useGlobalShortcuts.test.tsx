import { fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useGlobalShortcuts } from './useGlobalShortcuts.ts';

describe('useGlobalShortcuts', () => {
    afterEach(cleanup);

    it('calls the handler of a plain key press and prevents the default', () => {
        const n = vi.fn();
        renderHook(() => useGlobalShortcuts({ n }));
        const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);
        expect(n).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('is case-insensitive', () => {
        const p = vi.fn();
        renderHook(() => useGlobalShortcuts({ p }));
        fireEvent.keyDown(document.body, { key: 'P' });
        expect(p).toHaveBeenCalled();
    });

    it.each([
        ['input', <input data-testid="field" />],
        ['textarea', <textarea data-testid="field" />],
        ['select', <select data-testid="field"><option>a</option></select>],
        ['contenteditable', <div data-testid="field" contentEditable suppressContentEditableWarning>x</div>],
    ])('ignores keys typed into a %s', (_name, element) => {
        const n = vi.fn();
        const { getByTestId } = render(element);
        renderHook(() => useGlobalShortcuts({ n }));
        fireEvent.keyDown(getByTestId('field'), { key: 'n' });
        expect(n).not.toHaveBeenCalled();
    });

    it.each([['ctrlKey'], ['metaKey'], ['altKey']])('ignores keys pressed with %s', modifier => {
        const t = vi.fn();
        renderHook(() => useGlobalShortcuts({ t }));
        fireEvent.keyDown(document.body, { key: 't', [modifier]: true });
        expect(t).not.toHaveBeenCalled();
    });

    it('ignores keys while a dialog is open', () => {
        const n = vi.fn();
        const { getByTestId } = render(<div role="dialog"><button data-testid="inside">ok</button></div>);
        renderHook(() => useGlobalShortcuts({ n }));
        fireEvent.keyDown(getByTestId('inside'), { key: 'n' });
        expect(n).not.toHaveBeenCalled();
    });

    it('stops listening on unmount', () => {
        const n = vi.fn();
        const { unmount } = renderHook(() => useGlobalShortcuts({ n }));
        unmount();
        fireEvent.keyDown(document.body, { key: 'n' });
        expect(n).not.toHaveBeenCalled();
    });
});
