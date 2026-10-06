/**
 * "Draw dependency" in the Tasks tab (docs/tasks-tab.md): a mode in which a
 * line dragged from one row to another makes the start task depend on the
 * end task.  The button or a tap on AltGr (right Option on a Mac) turns it
 * on and off; AltGr held down draws only while held.  Esc stops.
 *
 * Rows carry `data-row-key`; the row under the pointer is found with
 * elementFromPoint (touch pointers stay captured by the start row), else the
 * event's target.  Near the edges of the scrolling area the view scrolls.
 *
 * The Week view's "Merge tasks" draws the same way between task cards
 * (``attribute: 'data-task-id'``, without AltGr; README: Calendar).
 */
import { useEffect, useRef, useState } from 'react';

import { isTyping } from './useGlobalShortcuts.ts';
import type { Point } from '../components/DependencyDrawLayer/DependencyDrawLayer.tsx';

export interface DrawLine {
    fromKey: string;
    /** The row under the pointer (null between rows). */
    overKey: string | null;
    from: Point;
    to: Point;
}

export interface DrawingOptions {
    /** The attribute that marks the elements a line goes between (its value is their key). */
    attribute?: string;
    /** A tap on AltGr toggles the mode (the Tasks tab). */
    altGr?: boolean;
}
/** Controls inside a row keep working (expand, complete, priority, ▶). */
const CONTROLS = 'button, input, [role="slider"], .MuiSlider-root';
/** Within this distance of the scrolling area's edge the view scrolls … */
const EDGE_PX = 48;
/** … by up to this much per frame. */
const MAX_SCROLL_PX = 16;
const MODIFIERS = ['Control', 'Shift', 'Alt', 'AltGraph', 'Meta'];

const isAltGr = (event: KeyboardEvent) => event.key === 'AltGraph' || event.code === 'AltRight';

function rowKeyAt(attribute: string, x: number, y: number, fallback: EventTarget | null): string | null {
    const element = document.elementFromPoint?.(x, y) ?? (fallback instanceof Element ? fallback : null);
    return element?.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null;
}

function scrollParent(element: Element | null): HTMLElement | null {
    for (let current = element?.parentElement; current; current = current.parentElement) {
        const { overflowY } = getComputedStyle(current);
        if (/(auto|scroll)/.test(overflowY) && current.scrollHeight > current.clientHeight) return current;
    }
    return document.scrollingElement as HTMLElement | null;
}

export function useDependencyDrawing(onDraw: (fromKey: string, toKey: string) => void,
    { attribute = 'data-row-key', altGr: withAltGr = true }: DrawingOptions = {}) {
    const [active, setActive] = useState(false);
    const [line, setLine] = useState<DrawLine | null>(null);
    const latest = useRef({ active, onDraw, attribute });
    useEffect(() => { latest.current = { active, onDraw, attribute }; });
    // The drag in progress: the start row and where on it the drag began.
    const start = useRef<{ key: string; row: HTMLElement; offset: Point; pointer: Point } | null>(null);
    // AltGr while held: the mode before it, and whether a line was drawn.
    const altGr = useRef<{ before: boolean; drew: boolean } | null>(null);

    const stopLine = () => { start.current = null; setLine(null); };

    // The line, computed from the start row's position now (it may scroll).
    const update = (pointer: Point, target: EventTarget | null) => {
        const drag = start.current;
        if (!drag) return;
        drag.pointer = pointer;
        const rect = drag.row.getBoundingClientRect();
        setLine({
            fromKey: drag.key,
            overKey: rowKeyAt(latest.current.attribute, pointer.x, pointer.y, target),
            from: { x: rect.left + drag.offset.x, y: rect.top + drag.offset.y },
            to: pointer,
        });
    };

    const onPointerDown = (event: React.PointerEvent) => {
        if (!latest.current.active || event.button !== 0) return;
        const target = event.target as Element;
        if (target.closest(CONTROLS)) return;
        const row = target.closest<HTMLElement>(`[${attribute}]`);
        const key = row?.getAttribute(attribute);
        if (!row || !key) return;
        event.preventDefault(); // no text selection while drawing
        const rect = row.getBoundingClientRect();
        const pointer = { x: event.clientX, y: event.clientY };
        start.current = { key, row, offset: { x: pointer.x - rect.left, y: pointer.y - rect.top }, pointer };
        if (altGr.current) altGr.current.drew = true;
        update(pointer, target);
    };

    // Keys: AltGr and Esc, wherever the focus is (not while typing).
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && (latest.current.active || start.current)) {
                stopLine();
                altGr.current = null;
                setActive(false);
            } else if (isAltGr(event)) {
                if (!withAltGr || event.repeat || altGr.current || isTyping(event.target)) return;
                altGr.current = { before: latest.current.active, drew: false };
                setActive(true);
            } else if (altGr.current && !MODIFIERS.includes(event.key)) {
                // AltGr + a key types a character (AltGr+Q is @): not ours.
                setActive(altGr.current.before);
                altGr.current = null;
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (!isAltGr(event) || !altGr.current) return;
            const { before, drew } = altGr.current;
            altGr.current = null;
            event.preventDefault(); // Firefox would open its menu bar on Alt
            setActive(drew ? before : !before); // a tap toggles; a hold was temporary
        };
        const onBlur = () => {
            if (altGr.current) setActive(altGr.current.before);
            altGr.current = null;
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [withAltGr]);

    // While a line is drawn: follow the pointer, scroll near the edges.
    const drawing = line !== null;
    useEffect(() => {
        if (!drawing) return;
        const onMove = (event: PointerEvent) => update({ x: event.clientX, y: event.clientY }, event.target);
        const onUp = (event: PointerEvent) => {
            const fromKey = start.current?.key;
            const toKey = rowKeyAt(latest.current.attribute, event.clientX, event.clientY, event.target);
            stopLine();
            if (fromKey && toKey && toKey !== fromKey) latest.current.onDraw(fromKey, toKey);
        };
        const onScroll = () => { if (start.current) update(start.current.pointer, null); };
        const scroller = scrollParent(start.current?.row ?? null);
        let frame = 0;
        const autoScroll = () => {
            const pointer = start.current?.pointer;
            if (pointer && scroller) {
                const { top, bottom } = scroller === document.scrollingElement
                    ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
                const into = pointer.y < top + EDGE_PX ? pointer.y - top - EDGE_PX
                    : pointer.y > bottom - EDGE_PX ? pointer.y - bottom + EDGE_PX : 0;
                if (into) scroller.scrollTop += Math.max(-1, Math.min(1, into / EDGE_PX)) * MAX_SCROLL_PX;
            }
            frame = window.requestAnimationFrame(autoScroll);
        };
        frame = window.requestAnimationFrame(autoScroll);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', stopLine);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', stopLine);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [drawing]);

    const toggle = () => {
        if (latest.current.active) stopLine();
        setActive(!latest.current.active);
    };

    return { active, toggle, line, onPointerDown };
}
