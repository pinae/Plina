/**
 * UI-9: tappable chips under the quick-add input on phones — typing `#`, `+`
 * or `30m` is slow there (docs/task-entry-ui.md §7). Projects (plus "No
 * project"), tags and a few durations; typed tokens still win over taps.
 * Presentational: the quick add owns the state.
 */
import { Box, Chip, Typography } from '@mui/material';

import type { Tag } from '../../types.ts';

const DURATION_CHOICES = [15, 30, 60, 120, 240];

const durationLabel = (minutes: number) => (minutes < 60 ? `${minutes}m` : `${minutes / 60}h`);

export interface QuickAddSuggestionsProps {
    projects: { id: string; label: string }[];
    /** Where the task goes now (null = top level). */
    parentId: string | null;
    onParent: (id: string | null) => void;
    tags: Tag[];
    tagIds: string[];
    onToggleTag: (id: string) => void;
    /** Chosen estimate; null = the default duration. */
    minutes: number | null;
    onMinutes: (minutes: number | null) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Box role="group" aria-label={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflowX: 'auto', py: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 56, flexShrink: 0 }}>{label}</Typography>
            {children}
        </Box>
    );
}

function Toggle({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
    return (
        <Chip label={label} size="medium" clickable onClick={onClick} aria-pressed={selected}
            color={selected ? 'primary' : 'default'} variant={selected ? 'filled' : 'outlined'}
            sx={{ flexShrink: 0 }} />
    );
}

export function QuickAddSuggestions({
    projects, parentId, onParent, tags, tagIds, onToggleTag, minutes, onMinutes,
}: QuickAddSuggestionsProps) {
    return (
        // Taps must not move the focus away from the input (phone keyboard).
        <Box onMouseDown={event => event.preventDefault()} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Row label="Project">
                <Toggle label="No project" selected={parentId === null} onClick={() => onParent(null)} />
                {projects.map(p => (
                    <Toggle key={p.id} label={p.label} selected={p.id === parentId} onClick={() => onParent(p.id)} />
                ))}
            </Row>
            {tags.length > 0 && (
                <Row label="Tags">
                    {tags.map(t => (
                        <Toggle key={t.id} label={`#${t.name}`} selected={tagIds.includes(t.id)} onClick={() => onToggleTag(t.id)} />
                    ))}
                </Row>
            )}
            <Row label="Estimate">
                {DURATION_CHOICES.map(m => (
                    <Toggle key={m} label={durationLabel(m)} selected={m === minutes}
                        onClick={() => onMinutes(m === minutes ? null : m)} />
                ))}
            </Row>
        </Box>
    );
}
