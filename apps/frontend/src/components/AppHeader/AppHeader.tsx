/**
 * UI-5: the "engage" header (docs/task-entry-ui.md §3): active project,
 * tracker and quick add, with the single-key shortcuts N (quick add),
 * P (project picker) and T (toggle tracking).
 *
 * Phones (UI-9, ≤ 600 px): the last level of the active project, a compact
 * tracker (⏹ time ✓) and icon buttons; the quick add becomes the ⊕ sheet.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, Tooltip } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';

import { ActiveProjectSwitcher } from '../ActiveProjectSwitcher/ActiveProjectSwitcher.tsx';
import { HeaderTracker } from '../HeaderTracker/HeaderTracker.tsx';
import { QuickAdd } from '../QuickAdd/QuickAdd.tsx';
import { QuickAddSheet } from '../QuickAddSheet/QuickAddSheet.tsx';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';
import { WhatNextDialog } from '../WhatNextDialog/WhatNextDialog.tsx';
import { SettingsPage } from '../SettingsPage/SettingsPage.tsx';
import { CompletionSnackbar } from '../CompletionSnackbar/CompletionSnackbar.tsx';
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts.ts';
import { useTracker } from '../../hooks/useTracker.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';
import { useTasks } from '../../queries.tsx';
import type { PlanAlternative } from '../../types.ts';

export interface AppHeaderProps {
    /** "Show all tasks" in the project picker: opens the Tasks tab. */
    onShowAllProjects?: () => void;
    /** Right-hand actions (e.g. "Plan my week"). */
    actions?: ReactNode;
}

export function AppHeader({ onShowAllProjects, actions }: AppHeaderProps) {
    const tasks = useTasks();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [choices, setChoices] = useState<PlanAlternative[] | null>(null);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const quickAddInput = useRef<HTMLInputElement>(null);
    const [autoCompleted, setAutoCompleted] = useState<{ id: string; header: string }[] | null>(null);
    const tracker = useTracker(setChoices, setAutoCompleted);
    const compact = useIsMobile();
    const [sheetOpen, setSheetOpen] = useState(false);

    useGlobalShortcuts({
        n: () => (compact ? setSheetOpen(true) : quickAddInput.current?.focus()),
        p: () => setPickerOpen(true),
        t: tracker.toggle,
    });

    const editingTask = tasks.data?.find(task => task.id === editingTaskId) ?? null;

    return (
        <Box component="header" sx={{
            display: 'flex', alignItems: 'center', gap: compact ? 0.5 : 1.5, px: compact ? 1 : 1.5, py: 0.75,
            minHeight: 52, minWidth: 0, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', flexShrink: 0,
        }}>
            <ActiveProjectSwitcher open={pickerOpen} onOpenChange={setPickerOpen}
                onShowAllProjects={onShowAllProjects} compact={compact} />
            {!compact && <Divider orientation="vertical" flexItem />}
            {/* On phones the project name gives way (ellipsis), not the timer. */}
            <Box sx={{ flexShrink: compact ? 0 : 1, minWidth: 0 }}>
                <HeaderTracker controls={tracker} onEditTask={setEditingTaskId} compact={compact} />
            </Box>
            {compact ? (
                <QuickAddSheet open={sheetOpen} onOpenChange={setSheetOpen} onOpenTask={setEditingTaskId} />
            ) : (
                <>
                    <Divider orientation="vertical" flexItem />
                    <QuickAdd inputRef={quickAddInput} onOpenTask={setEditingTaskId} />
                </>
            )}
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: compact ? 0 : 1, flexShrink: 0 }}>
                {actions}
                <Tooltip title="Settings">
                    <IconButton aria-label="settings" onClick={() => setSettingsOpen(true)}>
                        <SettingsIcon />
                    </IconButton>
                </Tooltip>
            </Box>
            <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Settings</DialogTitle>
                <DialogContent sx={{ pt: '8px !important' }}><SettingsPage /></DialogContent>
                <DialogActions><Button onClick={() => setSettingsOpen(false)}>Close</Button></DialogActions>
            </Dialog>
            {editingTask && (
                <TaskFormDialog open task={editingTask} onClose={() => setEditingTaskId(null)} />
            )}
            {/* With choices, the Undo sits in the dialog (see WhatNextDialog). */}
            <WhatNextDialog alternatives={choices} autoCompleted={autoCompleted}
                onClose={() => { setChoices(null); setAutoCompleted(null); }} />
            <CompletionSnackbar autoCompleted={choices ? null : autoCompleted}
                onClose={() => setAutoCompleted(null)} />
        </Box>
    );
}
