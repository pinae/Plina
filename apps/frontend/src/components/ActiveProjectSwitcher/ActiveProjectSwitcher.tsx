/**
 * UI-5: the active project in the header (docs/task-entry-ui.md §3.1).
 *
 * A breadcrumb of the active project — clicking an ancestor widens the scope
 * — and a picker (▾ or the P shortcut, hence controlled ``open``) to choose
 * another project, "No project", or create a new one from the typed text.
 * The choice lives on the server, so every device follows it.
 */
import { useMemo, useState } from 'react';
import { Box, Breadcrumbs, Button, IconButton, Link, Typography } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import { ProjectPicker, type ProjectPick } from '../ProjectPicker/ProjectPicker.tsx';
import { useCreateTask, useSettings, useTasks, useUpdateSettings } from '../../queries.tsx';
import { projectOptions } from '../../utils/projects.ts';

const RECENT_KEY = 'plina.recentProjects';
const RECENT_MAX = 5;

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

    const projects = useMemo(() => projectOptions(tasks.data ?? []), [tasks.data]);
    const path = settings.data?.active_task_path ?? [];
    const activeColor = projects.find(p => p.id === settings.data?.active_task_id)?.color
        ?? projects.find(p => p.id === path[0]?.id)?.color;
    // Recents are re-read whenever the picker opens.
    const recentIds = useMemo(() => (open ? readRecent() : []), [open]);

    const close = () => onOpenChange(false);

    const activate = (id: string | null) => {
        if (id) rememberRecent(id);
        update.mutate({ active_task_id: id });
    };

    const choose = (pick: ProjectPick) => {
        if (pick.kind === 'none') activate(null);
        else if (pick.kind === 'project') activate(pick.id);
        else {
            createTask.mutate({ header: pick.name, parent_id: null }, {
                onSuccess: task => activate(task.id),
            });
        }
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
            <ProjectPicker
                open={open} anchorEl={anchor} onClose={close} onPick={choose}
                projects={projects} recentIds={recentIds} allowCreate
                noneLabel="No project — new tasks become projects"
                placeholder="Find or create a project…"
                footer={onShowAllProjects && (
                    <Button size="small" fullWidth onClick={() => { close(); onShowAllProjects(); }}>
                        Show all projects
                    </Button>
                )}
            />
        </Box>
    );
}
