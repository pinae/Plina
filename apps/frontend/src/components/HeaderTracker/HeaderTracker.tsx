/**
 * UI-5: the time tracker in the header (docs/task-entry-ui.md §3.2).
 *
 * Tracking: ⏹, the task (click → edit dialog), a live hh:mm:ss timer that
 * turns amber with "+0:15 over" past the estimate, and ✓. Idle: ▶ "Next: …"
 * (the first planned task of the active project) and a picker for any task.
 * State and actions come from ``useTracker`` so the T shortcut shares them.
 */
import { useState } from 'react';
import { Alert, Box, Button, Divider, IconButton, ListSubheader, Menu, MenuItem, Snackbar, Tooltip, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CheckIcon from '@mui/icons-material/Check';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import type { TrackerControls } from '../../hooks/useTracker.ts';
import { useNow } from '../../hooks/useNow.ts';
import { formatElapsed, parseDurationMinutes } from '../../utils/duration.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** Seconds, from a DRF duration with optional fraction ("00:55:00.5"). */
function durationSeconds(value: string | null): number {
    const match = value?.match(/^(?:(\d+) )?(\d{1,2}):(\d{2}):(\d{2})/);
    if (!match) return 0;
    const [, days, h, m, s] = match;
    return (days ? +days * 86400 : 0) + +h * 3600 + +m * 60 + +s;
}

interface RunningTimerProps {
    start: string;
    spent: string;
    estimateMinutes: number;
    /** Phones: the time alone, amber when over (no "+… over" text). */
    compact?: boolean;
}

function RunningTimer({ start, spent, estimateMinutes, compact = false }: RunningTimerProps) {
    const now = useNow(1000);
    const elapsed = (now.getTime() - new Date(start).getTime()) / 1000;
    const overMinutes = Math.floor((durationSeconds(spent) + elapsed) / 60) - estimateMinutes;
    if (compact) {
        return (
            <Typography data-testid="tracker-elapsed" data-over={overMinutes > 0} variant="body2" component="span"
                sx={{ fontVariantNumeric: 'tabular-nums', color: overMinutes > 0 ? 'warning.main' : 'text.primary' }}>
                {formatElapsed(elapsed)}
            </Typography>
        );
    }
    return (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography data-testid="tracker-elapsed" variant="body2"
                sx={{ fontVariantNumeric: 'tabular-nums', color: overMinutes > 0 ? 'warning.main' : 'text.primary' }}>
                {formatElapsed(elapsed)}
            </Typography>
            {overMinutes > 0 && (
                <Typography data-testid="tracker-over" variant="caption" color="warning.main">
                    +{Math.floor(overMinutes / 60)}:{pad(overMinutes % 60)} over
                </Typography>
            )}
        </Box>
    );
}

export interface HeaderTrackerProps {
    controls: TrackerControls;
    onEditTask: (taskId: string) => void;
    /** Phones (UI-9): ⏹ time ✓ — the task is named in the time's label. */
    compact?: boolean;
}

export function HeaderTracker({ controls, onEditTask, compact = false }: HeaderTrackerProps) {
    const { tracked, next, pickable } = controls;
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const pick = (taskId: string) => {
        setMenuAnchor(null);
        controls.start(taskId);
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {tracked ? (
                <>
                    <Tooltip title="Stop tracking (T)">
                        <IconButton size="small" aria-label="stop tracking" onClick={controls.stop}
                            disabled={controls.pending}>
                            <StopIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {compact ? (
                        <Button size="small" color="inherit" aria-label={`tracking ${tracked.header}`}
                            onClick={() => onEditTask(tracked.id)} sx={{ minWidth: 0, px: 0.5 }}>
                            <RunningTimer compact start={tracked.active_tracking_start!} spent={tracked.time_spent}
                                estimateMinutes={parseDurationMinutes(tracked.duration) ?? controls.defaultDurationMinutes} />
                        </Button>
                    ) : (
                        <>
                            <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                                {controls.outsidePath && (
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.1 }}>
                                        {controls.outsidePath}
                                    </Typography>
                                )}
                                <Button size="small" color="inherit" onClick={() => onEditTask(tracked.id)}
                                    sx={{ textTransform: 'none', p: 0, minWidth: 0, justifyContent: 'flex-start', fontWeight: 'bold' }}>
                                    <Typography variant="body2" noWrap sx={{ maxWidth: 220, fontWeight: 'bold' }}>
                                        {tracked.header}
                                    </Typography>
                                </Button>
                            </Box>
                            <RunningTimer
                                start={tracked.active_tracking_start!}
                                spent={tracked.time_spent}
                                estimateMinutes={parseDurationMinutes(tracked.duration) ?? controls.defaultDurationMinutes}
                            />
                        </>
                    )}
                    <Tooltip title="Complete">
                        <IconButton size="small" aria-label="complete tracked task" onClick={controls.complete}
                            disabled={controls.pending}>
                            <CheckIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </>
            ) : next && compact ? (
                <IconButton size="small" aria-label={`start next: ${next.header}`}
                    onClick={() => controls.start(next.task_id)} disabled={controls.pending}>
                    <PlayArrowIcon fontSize="small" />
                </IconButton>
            ) : compact ? (
                <IconButton size="small" aria-label="start a task…"
                    onClick={event => setMenuAnchor(event.currentTarget)}>
                    <PlayArrowIcon fontSize="small" />
                </IconButton>
            ) : next ? (
                <Button size="small" color="inherit" startIcon={<PlayArrowIcon />}
                    aria-label={`start next: ${next.header}`} onClick={() => controls.start(next.task_id)}
                    disabled={controls.pending} sx={{ textTransform: 'none', minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 240 }}>Next: {next.header}</Typography>
                </Button>
            ) : (
                <Button size="small" color="inherit" startIcon={<PlayArrowIcon />}
                    onClick={event => setMenuAnchor(event.currentTarget)} sx={{ textTransform: 'none' }}>
                    Start a task…
                </Button>
            )}
            {!tracked && (
                <IconButton size="small" aria-label="choose a task to start"
                    onClick={event => setMenuAnchor(event.currentTarget)}>
                    <ArrowDropDownIcon fontSize="small" />
                </IconButton>
            )}
            <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}
                slotProps={{ paper: { sx: { maxHeight: 420, minWidth: 260 } } }}>
                {pickable.inProject.length > 0 && <ListSubheader>Active project</ListSubheader>}
                {pickable.inProject.map(t => (
                    <MenuItem key={t.id} onClick={() => pick(t.id)}>{t.header}</MenuItem>
                ))}
                {pickable.inProject.length > 0 && pickable.others.length > 0 && <Divider />}
                {pickable.others.map(t => (
                    <MenuItem key={t.id} onClick={() => pick(t.id)}>{t.header}</MenuItem>
                ))}
                {pickable.inProject.length + pickable.others.length === 0 && (
                    <MenuItem disabled>No open tasks</MenuItem>
                )}
            </Menu>
            <Snackbar open={controls.error !== null} autoHideDuration={6000} onClose={controls.clearError}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="error" variant="filled" onClose={controls.clearError}>{controls.error}</Alert>
            </Snackbar>
        </Box>
    );
}
