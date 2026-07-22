/**
 * Mouse-driven move/resize for a Week-view item.
 *
 * A `mousedown` on the body ("move") or on a top/bottom handle ("resize-*")
 * starts a drag; subsequent movement is tracked on the window so the pointer
 * can leave the element.  While dragging, `preview` holds the tentative
 * start/duration for immediate visual feedback; on release `onCommit` fires
 * once (only if something actually changed).  A "move" press that never
 * exceeds the movement threshold is treated as a plain click (`onClick`),
 * so the same body serves both editing (click) and moving (drag).
 */
import { useCallback, useRef, useState } from 'react';
import { applyDrag, pixelsToMinutes, type DragMode, type DragResult } from '../utils/weekDrag.ts';

const MOVE_THRESHOLD_PX = 3;

/** Where the pointer ended, plus which kind of drag it was — lets the caller
 *  resolve a horizontal (cross-day) move from clientX. */
export interface DragCommitContext {
    mode: DragMode;
    clientX: number;
    clientY: number;
}

interface Args {
    startMinutes: number;
    durationMinutes: number;
    /** Pixel height of a full 1440-minute day (current zoom). */
    columnHeight: number;
    onCommit: (result: DragResult, ctx: DragCommitContext) => void;
    /** Fired when a "move" press ends without dragging (a plain click). */
    onClick?: () => void;
    /** Notified when a drag starts (true) and ends (false). */
    onActiveChange?: (active: boolean) => void;
}

export function useVerticalDrag({
    startMinutes, durationMinutes, columnHeight, onCommit, onClick, onActiveChange,
}: Args) {
    const [preview, setPreview] = useState<DragResult | null>(null);
    const origin = useRef(0);
    const moved = useRef(false);

    const startDrag = useCallback((mode: DragMode) => (event: React.MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        origin.current = event.clientY;
        moved.current = false;
        onActiveChange?.(true);

        const compute = (clientY: number): DragResult => applyDrag(
            mode, startMinutes, durationMinutes,
            pixelsToMinutes(clientY - origin.current, columnHeight),
        );

        const onMove = (ev: MouseEvent) => {
            if (Math.abs(ev.clientY - origin.current) > MOVE_THRESHOLD_PX) moved.current = true;
            setPreview(compute(ev.clientY));
        };
        const onUp = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            setPreview(null);
            onActiveChange?.(false);
            if (!moved.current) {
                if (mode === 'move') onClick?.();
                return;
            }
            const result = compute(ev.clientY);
            const ctx = { mode, clientX: ev.clientX, clientY: ev.clientY };
            // A move always commits once dragged — the target day may differ
            // even when the time is unchanged. A resize only commits on change.
            if (mode === 'move') {
                onCommit(result, ctx);
            } else if (
                result.startMinutes !== startMinutes
                || result.durationMinutes !== durationMinutes
            ) {
                onCommit(result, ctx);
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [startMinutes, durationMinutes, columnHeight, onCommit, onClick, onActiveChange]);

    return { preview, dragging: preview !== null, startDrag };
}
