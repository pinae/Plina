/**
 * A popover to pick a project or sub-project: type to filter, ↑/↓ + Enter,
 * a "none" entry (e.g. "No project" / "Top level") and optionally
 * "+ New project …" from the typed text. Used by the active project switcher
 * (UI-5) and the outline's "move to" (UI-7).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Autocomplete, Box, Popover, TextField, Typography, type PopperProps } from '@mui/material';

import type { ProjectOption } from '../../utils/projects.ts';

export type ProjectPick = { kind: 'none' } | { kind: 'project'; id: string } | { kind: 'create'; name: string };

type Option =
    | { kind: 'none' }
    | { kind: 'project'; project: ProjectOption; recent: boolean }
    | { kind: 'create'; name: string };

/** Renders the suggestion list in the flow of the popover instead of as a
 *  floating layer, so the popover grows with it. */
function InlineList({ open, children }: PopperProps) {
    return open ? <Box>{children as ReactNode}</Box> : null;
}

const optionKey = (option: Option) =>
    option.kind === 'project' ? option.project.id : option.kind === 'create' ? `create:${option.name}` : 'none';

export interface ProjectPickerProps {
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    onPick: (pick: ProjectPick) => void;
    projects: ProjectOption[];
    noneLabel: string;
    allowCreate?: boolean;
    /** Listed first, with their full path. */
    recentIds?: string[];
    placeholder?: string;
    footer?: ReactNode;
}

export function ProjectPicker({
    open, anchorEl, onClose, onPick, projects, noneLabel, allowCreate = false, recentIds = [],
    placeholder = 'Find a project…', footer,
}: ProjectPickerProps) {
    const [input, setInput] = useState('');

    const options = useMemo<Option[]>(() => {
        const recent = recentIds
            .map(id => projects.find(p => p.id === id))
            .filter((p): p is ProjectOption => p !== undefined);
        return [
            { kind: 'none' },
            ...recent.map(project => ({ kind: 'project', project, recent: true }) as Option),
            ...projects.filter(p => !recentIds.includes(p.id))
                .map(project => ({ kind: 'project', project, recent: false }) as Option),
        ];
    }, [projects, recentIds]);

    const close = () => {
        setInput('');
        onClose();
    };

    const filterOptions = (list: Option[], { inputValue }: { inputValue: string }) => {
        const query = inputValue.trim().toLowerCase();
        if (!query) return list;
        // Exact name, then names starting with the text, then other path
        // matches; the sort is stable, so recents stay first within a rank.
        const rank = (o: Option) => {
            const header = o.kind === 'project' ? o.project.header.toLowerCase() : '';
            return header === query ? 0 : header.startsWith(query) ? 1 : 2;
        };
        const matches = list
            .filter(o => o.kind === 'project' && o.project.path.toLowerCase().includes(query))
            .sort((a, b) => rank(a) - rank(b));
        const exact = matches.some(o => rank(o) === 0);
        return allowCreate && !exact ? [...matches, { kind: 'create', name: inputValue.trim() } as Option] : matches;
    };

    const choose = (option: Option | null) => {
        if (!option) return;
        close();
        onPick(option.kind === 'project' ? { kind: 'project', id: option.project.id } : option);
    };

    return (
        <Popover open={open && anchorEl !== null} anchorEl={anchorEl} onClose={close}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
            <Box sx={{ width: 340, p: 1 }}>
                <Autocomplete<Option>
                    open disablePortal autoHighlight
                    options={options}
                    filterOptions={filterOptions}
                    inputValue={input}
                    onInputChange={(_event, value) => setInput(value)}
                    onChange={(_event, value) => choose(value)}
                    value={null}
                    getOptionLabel={option => option.kind === 'project' ? option.project.path
                        : option.kind === 'create' ? option.name : noneLabel}
                    isOptionEqualToValue={(a, b) => optionKey(a) === optionKey(b)}
                    renderOption={(props, option) => {
                        const { key, ...rest } = props;
                        return (
                            <li key={key} {...rest}>
                                {option.kind === 'none' && (
                                    <Typography variant="body2" color="text.secondary">{noneLabel}</Typography>
                                )}
                                {option.kind === 'create' && (
                                    <Typography variant="body2">+ New project “{option.name}”</Typography>
                                )}
                                {option.kind === 'project' && (
                                    <Typography variant="body2" noWrap
                                        sx={{ pl: input || option.recent ? 0 : option.project.depth * 2 }}>
                                        {input || option.recent ? option.project.path : option.project.header}
                                    </Typography>
                                )}
                            </li>
                        );
                    }}
                    renderInput={params => (
                        <TextField {...params} autoFocus size="small" placeholder={placeholder} />
                    )}
                    slots={{ popper: InlineList }}
                    slotProps={{ listbox: { sx: { maxHeight: 320 } }, paper: { elevation: 0 } }}
                />
                {footer}
            </Box>
        </Popover>
    );
}
