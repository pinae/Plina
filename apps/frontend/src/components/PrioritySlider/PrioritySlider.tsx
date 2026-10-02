/**
 * T-5 (docs/tasks-tab.md): the priority of a task as a small slider 0–10 —
 * click a position or drag; the value is committed once, on release (arrow
 * keys step by one). The track is coloured by band like Todoist's flags. On
 * phones (``compact``) a coloured "!7" chip opens the slider in a popover.
 */
import { useState } from 'react';
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
    const shown = dragValue ?? committed ?? value;
    const band = priorityBand(shown);

    const slider = (
        <Slider
            size="small" min={0} max={10} step={1} value={shown}
            valueLabelDisplay="auto"
            onChange={(_event, next) => setDragValue(next as number)}
            onChangeCommitted={(_event, next) => {
                setDragValue(null);
                if (next === value) return;
                setCommitted(next as number);
                const saving = onCommit(next as number);
                if (saving instanceof Promise) saving.catch(() => undefined).finally(() => setCommitted(null));
            }}
            slotProps={{ input: { 'aria-label': `priority of ${label}` } }}
            sx={{ color: PRIORITY_COLOR[band], width: compact ? 200 : 72, mx: compact ? 1 : 0 }}
        />
    );

    return (
        // The row behind opens the edit dialog on click: keep clicks here.
        <Box data-testid="priority-slider" data-band={band} onClick={event => event.stopPropagation()}
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
                    {slider}
                    <Typography variant="caption" sx={{ width: 16, textAlign: 'right', color: PRIORITY_COLOR[band], fontWeight: 'bold' }}>
                        {shown}
                    </Typography>
                </>
            )}
        </Box>
    );
}
