import { useState } from 'react';
import {
    Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField,
} from '@mui/material';

import { useCreateTask } from '../queries';

interface AddTaskDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Minimal inline task creation (WP-9); the full task form arrives in WP-12. */
export function AddTaskDialog({ open, onClose }: AddTaskDialogProps) {
    const [header, setHeader] = useState('');
    const [hours, setHours] = useState('1');
    const create = useCreateTask();

    const submit = () => {
        if (!header.trim()) return;
        const wholeHours = Math.max(0, Math.floor(Number(hours) || 1));
        create.mutate(
            {
                header: header.trim(),
                duration: `${String(wholeHours).padStart(2, '0')}:00:00`,
            },
            {
                onSuccess: () => {
                    setHeader('');
                    onClose();
                },
            },
        );
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>New task</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                    label="Header" value={header} autoFocus margin="dense"
                    onChange={event => setHeader(event.target.value)}
                    onKeyDown={event => event.key === 'Enter' && submit()}
                />
                <TextField
                    label="Duration (hours)" value={hours} type="number"
                    onChange={event => setHours(event.target.value)}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={submit} disabled={create.isPending}>
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );
}
