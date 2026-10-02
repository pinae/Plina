/**
 * UI-9: quick add on phones (docs/task-entry-ui.md §3, §7) — a floating ⊕
 * button opens a bottom sheet with the quick add in its ``sheet`` variant
 * (tappable project/tag/estimate chips). The sheet stays open after Add for
 * the next thought; the close button, a swipe/tap outside or Escape close it.
 */
import { Box, Drawer, Fab, IconButton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';

import { QuickAdd } from '../QuickAdd/QuickAdd.tsx';

export interface QuickAddSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** "Add and open details" from the sheet (not used on phones yet). */
    onOpenTask?: (taskId: string) => void;
}

export function QuickAddSheet({ open, onOpenChange, onOpenTask }: QuickAddSheetProps) {
    return (
        <>
            {!open && (
                <Fab color="primary" aria-label="add task" onClick={() => onOpenChange(true)}
                    sx={{
                        position: 'fixed', right: 16, zIndex: 'speedDial',
                        // Clear of the iPhone home indicator.
                        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
                    }}>
                    <AddIcon />
                </Fab>
            )}
            <Drawer anchor="bottom" open={open} onClose={() => onOpenChange(false)}
                slotProps={{
                    paper: {
                        role: 'dialog', 'aria-label': 'Add task',
                        sx: {
                            borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: '85vh',
                            px: 2, pt: 1, pb: 'calc(16px + env(safe-area-inset-bottom, 0px))',
                        },
                    },
                }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', flex: 1 }}>Add task</Typography>
                    <IconButton aria-label="close" onClick={() => onOpenChange(false)}><CloseIcon /></IconButton>
                </Box>
                <QuickAdd variant="sheet" onOpenTask={onOpenTask} />
            </Drawer>
        </>
    );
}
