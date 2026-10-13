/**
 * T-5 (docs/tasks-tab.md): the priority of a task as a small slider 0–10 —
 * click a position or drag; the value is committed once, on release (arrow
 * keys step by one). The track is coloured by band like Todoist's flags. On
 * phones (``compact``) a coloured "!7" chip opens the slider in a popover.
 *
 * A tree shows hundreds of them: until hovered or focused, each is a light
 * display of the same look (README: Performance); a press on it (touch, no
 * hover) sets the value there at once, like a click on the track.
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Chip, Popover, Slider, Typography } from '@mui/material';

import { PRIORITY_COLOR, priorityBand } from '../../utils/priority.ts';

export interface PrioritySliderProps {
    value: number;
    /** The task's name, for the accessible label. */
    label: string;
    /** Called once per change, with the new value. A returned promise marks
     *  the save: until it settles the slider holds the committed value. */
    onCommit: (priority: number) => void | Promise<unknown>;
    compact?: boolean;
}

export function PrioritySlider({ value, label, onCommit, compact = false }: PrioritySliderProps) {
    // While dragging, the slider shows the value under the pointer; after the
    // release, the committed value until the save settles or ``value``
    // changes — whatever comes first (an optimistic update and its rollback
    // can arrive in one render).
    const [dragValue, setDragValue] = useState<number | null>(null);
    const [committed, setCommitted] = useState<number | null>(null);
    const [seenValue, setSeenValue] = useState(value);
    if (value !== seenValue) {
        setSeenValue(value);
        setCommitted(null);
    }
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const shown = dragValue ?? committed ?? value;
    const band = priorityBand(shown);
    // The real slider only while it is used: hovered, focused or dragged.
    const live = hovered || focused || dragValue !== null;
    const root = useRef<HTMLDivElement>(null);
    // Focus came to the display: move it into the slider that replaced it.
    useEffect(() => {
        if (!live || !focused) return;
        const input = root.current?.querySelector('input');
        if (input && !root.current?.contains(document.activeElement)) input.focus();
    }, [live, focused]);

    const commit = (next: number) => {
        if (next === value) return;
        setCommitted(next);
        const saving = onCommit(next);
        if (saving instanceof Promise) saving.catch(() => undefined).finally(() => setCommitted(null));
    };

    const slider = (
        <Slider
            size="small" min={0} max={10} step={1} value={shown}
            valueLabelDisplay="auto"
            onChange={(_event, next) => setDragValue(next as number)}
            onChangeCommitted={(_event, next) => {
                setDragValue(null);
                commit(next as number);
            }}
            slotProps={{ input: { 'aria-label': `priority of ${label}` } }}
            sx={{ color: PRIORITY_COLOR[band], width: compact ? 200 : 72, mx: compact ? 1 : 0 }}
        />
    );

    return (
        // The row behind opens the edit dialog on click: keep clicks here.
        <Box ref={root} data-testid="priority-slider" data-band={band} onClick={event => event.stopPropagation()}
            onPointerEnter={compact ? undefined : () => setHovered(true)}
            onPointerLeave={compact ? undefined : () => setHovered(false)}
            onFocus={compact ? undefined : () => setFocused(true)}
            onBlur={compact ? undefined : event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
            }}
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {compact ? (
                <>
                    <Chip size="small" variant="outlined" label={`!${value}`} data-band={band}
                        aria-label={`priority of ${label}: ${value}`}
                        onClick={event => setAnchor(event.currentTarget)}
                        sx={{ height: 22, borderColor: PRIORITY_COLOR[band], color: PRIORITY_COLOR[band], fontWeight: 'bold' }} />
                    <Popover open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                        <Box onClick={event => event.stopPropagation()} sx={{ px: 2, pt: 1, pb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Priority of “{label}”: {shown}</Typography>
                            {slider}
                        </Box>
                    </Popover>
                </>
            ) : (
                <>
                    {live ? slider : (
                        <SliderDisplay value={shown} label={label} color={PRIORITY_COLOR[band]}
                            onPress={next => commit(next)} />
                    )}
                    <Typography variant="caption" sx={{ width: 16, textAlign: 'right', color: PRIORITY_COLOR[band], fontWeight: 'bold' }}>
                        {shown}
                    </Typography>
                </>
            )}
        </Box>
    );
}

/** The look of the small slider (rail, track, thumb) without its machinery:
 *  a few elements instead of a slider's dozen and its listeners. */
function SliderDisplay({ value, label, color, onPress }: {
    value: number; label: string; color: string; onPress: (value: number) => void;
}) {
    const percent = `${value * 10}%`;
    return (
        <Box role="slider" tabIndex={0} aria-label={`priority of ${label}`}
            aria-valuemin={0} aria-valuemax={10} aria-valuenow={value} aria-orientation="horizontal"
            onPointerDown={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                if (rect.width > 0 && Number.isFinite(event.clientX)) onPress(Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 10));
            }}
            sx={{ position: 'relative', width: 72, height: 4, py: '13px', boxSizing: 'content-box', cursor: 'pointer', color }}>
            <Box sx={{ position: 'absolute', top: 13, left: 0, right: 0, height: 4, borderRadius: 2, bgcolor: 'currentColor', opacity: 0.38 }} />
            <Box style={{ width: percent }} sx={{ position: 'absolute', top: 13, left: 0, height: 4, borderRadius: 2, bgcolor: 'currentColor' }} />
            <Box style={{ left: percent }} sx={{
                position: 'absolute', top: 15, width: 12, height: 12, borderRadius: '50%', bgcolor: 'currentColor',
                transform: 'translate(-50%, -50%)',
            }} />
        </Box>
    );
}
