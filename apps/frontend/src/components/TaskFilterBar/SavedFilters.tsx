/**
 * Saved filters (README: Filtering tasks): named filters, synced to all
 * devices. On the desktop a "Saved" menu in the filter bar — it shows the
 * name of the saved filter that is on; on phones a row of chips at the top
 * of the filter sheet. Both save the current filter under a name (an
 * existing name replaces that filter) and delete after asking.
 */
import { useState } from 'react';
import {
    Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, IconButton,
    ListItemIcon, ListItemText, Menu, MenuItem, TextField, Tooltip, Typography,
} from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAddOutlined';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import type { AxiosError } from 'axios';

import { useDeleteSavedFilter, useSaveFilter, useSavedFilters } from '../../queries.tsx';
import type { SavedFilter } from '../../types.ts';
import { filtersEqual, isFiltering, normalizeFilter, type TaskFilter } from '../../utils/taskFilter.ts';

interface SavedFiltersProps {
    filter: TaskFilter;
    onChange: (filter: TaskFilter) => void;
}

/** What both layouts share: the list, which one is on, saving, deleting. */
function useSaved(filter: TaskFilter) {
    const saved = useSavedFilters();
    const list = saved.data ?? [];
    const current = list.find(item => filtersEqual(normalizeFilter(item.filter), filter)) ?? null;
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<SavedFilter | null>(null);
    return { list, current, saving, setSaving, deleting, setDeleting };
}

/** Desktop: the "Saved" button and its menu. */
export function SavedFiltersButton({ filter, onChange }: SavedFiltersProps) {
    const { list, current, saving, setSaving, deleting, setDeleting } = useSaved(filter);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = () => setAnchor(null);

    return (
        <>
            <Button size="small" variant={current ? 'contained' : 'outlined'} disableElevation
                color={current ? 'primary' : 'inherit'}
                startIcon={current ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                aria-haspopup="menu" aria-expanded={anchor !== null}
                onClick={event => setAnchor(event.currentTarget)}
                sx={{ textTransform: 'none', ...(current ? {} : { color: 'text.secondary', borderColor: 'divider' }) }}>
                {current ? current.name : 'Saved'}
            </Button>
            <Menu open={anchor !== null} anchorEl={anchor} onClose={close}
                slotProps={{ list: { 'aria-label': 'Saved filters', dense: true } }}>
                {list.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1, maxWidth: 260 }}>
                        No saved filters yet. Set a filter, then save it here.
                    </Typography>
                )}
                {list.map(item => (
                    <MenuItem key={item.id} selected={item === current}
                        onClick={() => { onChange(normalizeFilter(item.filter)); close(); }}>
                        <ListItemIcon>{item === current && <CheckIcon fontSize="small" />}</ListItemIcon>
                        <ListItemText>{item.name}</ListItemText>
                        <Tooltip title="Delete">
                            <IconButton size="small" edge="end" aria-label={`delete ${item.name}`} sx={{ ml: 2 }}
                                onClick={event => { event.stopPropagation(); close(); setDeleting(item); }}>
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </MenuItem>
                ))}
                <Divider />
                <MenuItem disabled={!isFiltering(filter) || current !== null}
                    onClick={() => { close(); setSaving(true); }}>
                    <ListItemIcon><BookmarkAddIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>Save current filter…</ListItemText>
                </MenuItem>
            </Menu>
            {saving && <SaveFilterDialog filter={filter} list={list} onClose={() => setSaving(false)} />}
            {deleting && <DeleteSavedDialog saved={deleting} onClose={() => setDeleting(null)} />}
        </>
    );
}

/** Phones: the top section of the filter sheet. */
export function SavedFiltersSection({ filter, onChange }: SavedFiltersProps) {
    const { list, current, saving, setSaving, deleting, setDeleting } = useSaved(filter);
    return (
        <Box component="section" aria-label="Saved filters">
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Saved filters</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
                {list.map(item => (
                    <Chip key={item.id} label={item.name} size="small" clickable
                        icon={item === current ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                        color={item === current ? 'primary' : 'default'} variant={item === current ? 'filled' : 'outlined'}
                        aria-pressed={item === current}
                        onClick={() => onChange(normalizeFilter(item.filter))}
                        onDelete={() => setDeleting(item)} />
                ))}
                <Button size="small" startIcon={<BookmarkAddIcon />} disabled={!isFiltering(filter) || current !== null}
                    onClick={() => setSaving(true)}>
                    Save current filter
                </Button>
            </Box>
            {saving && <SaveFilterDialog filter={filter} list={list} onClose={() => setSaving(false)} />}
            {deleting && <DeleteSavedDialog saved={deleting} onClose={() => setDeleting(null)} />}
        </Box>
    );
}

/** A name for the current filter; an existing name replaces that filter. */
function SaveFilterDialog({ filter, list, onClose }: { filter: TaskFilter; list: SavedFilter[]; onClose: () => void }) {
    const save = useSaveFilter();
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const existing = list.find(item => item.name.toLowerCase() === name.trim().toLowerCase());

    const submit = () => {
        if (!name.trim()) { setError('Give the filter a name.'); return; }
        save.mutate({ id: existing?.id, name: name.trim(), filter: normalizeFilter(filter) }, {
            onSuccess: onClose,
            onError: failure => {
                const data = (failure as AxiosError<Record<string, string[]>>).response?.data;
                setError(data?.name?.[0] ?? data?.filter?.[0] ?? 'The filter could not be saved.');
            },
        });
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>Save filter</DialogTitle>
            <DialogContent>
                <TextField autoFocus fullWidth margin="dense" label="Name" value={name}
                    placeholder="e.g. Deep work"
                    error={error !== null}
                    helperText={error ?? (existing ? `Replaces the saved filter “${existing.name}”.`
                        : 'Saved filters are on all your devices.')}
                    onChange={event => { setName(event.target.value); setError(null); }}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
                    slotProps={{ htmlInput: { maxLength: 128 } }} />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={submit} disabled={save.isPending}>
                    {existing ? `Replace “${existing.name}”` : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function DeleteSavedDialog({ saved, onClose }: { saved: SavedFilter; onClose: () => void }) {
    const remove = useDeleteSavedFilter();
    return (
        <Dialog open onClose={onClose}>
            <DialogTitle>Delete “{saved.name}”?</DialogTitle>
            <DialogContent>
                <DialogContentText>The saved filter goes; the filter that is on stays as it is.</DialogContentText>
                {remove.isError && <Typography color="error" variant="body2">It could not be deleted.</Typography>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Keep</Button>
                <Button color="error" disabled={remove.isPending}
                    onClick={() => remove.mutate(saved.id, { onSuccess: onClose })}>
                    Delete
                </Button>
            </DialogActions>
        </Dialog>
    );
}
