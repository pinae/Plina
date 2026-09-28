/**
 * UI-5: the active project in the header (docs/task-entry-ui.md §3.1).
 *
 * A breadcrumb of the active project — clicking an ancestor widens the scope
 * — and a picker (▾ or the P shortcut, hence controlled ``open``) to choose
 * another project, "No project", or create a new one from the typed text.
 * The choice lives on the server, so every device follows it.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
    Autocomplete, Box, Breadcrumbs, Button, IconButton, Link, Popover, TextField, Typography,
    type PopperProps,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import { useCreateTask, useSettings, useTasks, useUpdateSettings } from '../../queries.tsx';
import { projectOptions, type ProjectOption } from '../../utils/projects.ts';

const RECENT_KEY = 'plina.recentProjects';
const RECENT_MAX = 5;

type Option =
    | { kind: 'none' }
    | { kind: 'project'; project: ProjectOption; recent: boolean }
    | { kind: 'create'; name: string };

// Recently used projects are a per-browser convenience (not synced).
function readRecent(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
        return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

function rememberRecent(id: string) {
    try {
        const next = [id, ...readRecent().filter(r => r !== id)].slice(0, RECENT_MAX);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        // Storage unavailable (private mode): recents are optional.
    }
}

/** Renders the suggestion list in the flow of the popover instead of as a
 *  floating layer, so the popover grows with it. */
function InlineList({ open, children }: PopperProps) {
    return open ? <Box>{children as ReactNode}</Box> : null;
}

const optionKey = (option: Option) =>
    option.kind === 'project' ? option.project.id : option.kind === 'create' ? `create:${option.name}` : 'none';

export interface ActiveProjectSwitcherProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onShowAllProjects?: () => void;
}

export function ActiveProjectSwitcher({ open, onOpenChange, onShowAllProjects }: ActiveProjectSwitcherProps) {
    const settings = useSettings();
    const tasks = useTasks();
    const update = useUpdateSettings();
    const createTask = useCreateTask();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [input, setInput] = useState('');

    const projects = useMemo(() => projectOptions(tasks.data ?? []), [tasks.data]);
    const path = settings.data?.active_task_path ?? [];
    const activeColor = projects.find(p => p.id === settings.data?.active_task_id)?.color
        ?? projects.find(p => p.id === path[0]?.id)?.color;

    const baseOptions = useMemo<Option[]>(() => {
        // Recents are re-read whenever the picker opens.
        const recent = open ? readRecent() : [];
        const recentProjects = recent
            .map(id => projects.find(p => p.id === id))
            .filter((p): p is ProjectOption => p !== undefined);
        return [
            { kind: 'none' },
            ...recentProjects.map(project => ({ kind: 'project', project, recent: true }) as Option),
            ...projects.filter(p => !recent.includes(p.id))
                .map(project => ({ kind: 'project', project, recent: false }) as Option),
        ];
    }, [projects, open]);

    const close = () => {
        onOpenChange(false);
        setInput('');
    };

    const activate = (id: string | null) => {
        if (id) rememberRecent(id);
        update.mutate({ active_task_id: id });
    };

    const choose = (option: Option | null) => {
        if (!option) return;
        close();
        if (option.kind === 'none') activate(null);
        else if (option.kind === 'project') activate(option.project.id);
        else {
            createTask.mutate({ header: option.name, parent_id: null }, {
                onSuccess: task => activate(task.id),
            });
        }
    };

    const filterOptions = (options: Option[], { inputValue }: { inputValue: string }) => {
        const query = inputValue.trim().toLowerCase();
        if (!query) return options;
        const matches = options.filter(o =>
            o.kind === 'project' && o.project.path.toLowerCase().includes(query));
        const exact = matches.some(o => o.kind === 'project' && o.project.header.toLowerCase() === query);
        return exact ? matches : [...matches, { kind: 'create', name: inputValue.trim() } as Option];
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Box sx={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                bgcolor: activeColor ?? 'text.disabled',
            }} />
            <Breadcrumbs aria-label="active project" separator="›" maxItems={3}
                sx={{ minWidth: 0, '& ol': { flexWrap: 'nowrap' } }}>
                {path.length === 0 && (
                    <Typography variant="body2" color="text.secondary">No project</Typography>
                )}
                {path.map((crumb, index) => index < path.length - 1 ? (
                    <Link key={crumb.id} component="button" variant="body2" color="inherit"
                        underline="hover" onClick={() => activate(crumb.id)}>
                        {crumb.header}
                    </Link>
                ) : (
                    <Typography key={crumb.id} variant="body2" noWrap sx={{ fontWeight: 'bold' }}>
                        {crumb.header}
                    </Typography>
                ))}
            </Breadcrumbs>
            <IconButton ref={setAnchor} size="small" aria-label="change active project (P)"
                onClick={() => (open ? close() : onOpenChange(true))}>
                <ArrowDropDownIcon />
            </IconButton>
            <Popover open={open && anchor !== null} anchorEl={anchor} onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Box sx={{ width: 340, p: 1 }}>
                    <Autocomplete<Option>
                        open disablePortal autoHighlight
                        options={baseOptions}
                        filterOptions={filterOptions}
                        inputValue={input}
                        onInputChange={(_event, value) => setInput(value)}
                        onChange={(_event, value) => choose(value)}
                        value={null}
                        getOptionLabel={option => option.kind === 'project' ? option.project.path
                            : option.kind === 'create' ? option.name : 'No project'}
                        isOptionEqualToValue={(a, b) => optionKey(a) === optionKey(b)}
                        renderOption={(props, option) => {
                            const { key, ...rest } = props;
                            return (
                                <li key={key} {...rest}>
                                    {option.kind === 'none' && (
                                        <Typography variant="body2" color="text.secondary">
                                            No project — new tasks become projects
                                        </Typography>
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
                            <TextField {...params} autoFocus size="small" placeholder="Find or create a project…" />
                        )}
                        slots={{ popper: InlineList }}
                        slotProps={{ listbox: { sx: { maxHeight: 320 } }, paper: { elevation: 0 } }}
                    />
                    {onShowAllProjects && (
                        <Button size="small" fullWidth onClick={() => { close(); onShowAllProjects(); }}>
                            Show all projects
                        </Button>
                    )}
                </Box>
            </Popover>
        </Box>
    );
}
