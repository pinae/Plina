import { useState } from 'react';
import {
    Box, Button, Chip, Fab, List, ListItem, ListItemText, Paper, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { useBucketTypes } from '../../queries.tsx';
import type { TimeBucketType } from '../../types.ts';
import { formatDuration } from '../../utils/duration.ts';
import { BucketTypeFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';

const frame = (bucketType: TimeBucketType) => {
    const format = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }) : '');
    return `${format(bucketType.special_start)} – ${format(bucketType.special_end)}`;
};

/** The "Time Buckets" pane: the recurring time buckets, then the special
 *  ones (README: Calendar), each with an add button. */
export default function BucketTypeList() {
    const bucketTypesQuery = useBucketTypes();
    const all = bucketTypesQuery.data ?? [];
    const bucketTypes = all.filter(bucketType => !bucketType.is_special);
    const specials = all.filter(bucketType => bucketType.is_special)
        .sort((a, b) => (a.special_start ?? '').localeCompare(b.special_start ?? ''));
    const [adding, setAdding] = useState(false);
    const [addingSpecial, setAddingSpecial] = useState(false);
    const [editBucket, setEditBucket] = useState<TimeBucketType | null>(null);
    const close = () => { setAdding(false); setAddingSpecial(false); setEditBucket(null); };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Time Buckets
            </Typography>
            <Paper>
                <List>
                    {bucketTypes.map(bucketType => (
                        <ListItem
                            key={bucketType.id} divider onClick={() => setEditBucket(bucketType)}
                            sx={{ cursor: 'pointer' }}
                        >
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: bucketType.hex_color || '#ccc' }} />
                                        <Typography variant="subtitle1">{bucketType.name}</Typography>
                                        {bucketType.tags.map(tag => (
                                            <Chip key={tag.id} label={`#${tag.name}`} size="small" sx={{ bgcolor: tag.hex_color, color: '#fff' }} />
                                        ))}
                                    </Box>
                                }
                                secondary={
                                    <>
                                        <Typography variant="body2" component="span">{bucketType.start_times}</Typography>
                                        <Typography variant="body2" component="span"> · {formatDuration(bucketType.duration)}</Typography>
                                    </>
                                }
                            />
                        </ListItem>
                    ))}
                    {bucketTypes.length === 0 && (
                        <ListItem>
                            <Typography variant="body2" color="text.secondary">
                                No time buckets yet.
                            </Typography>
                        </ListItem>
                    )}
                </List>
            </Paper>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 4, mb: 1 }}>
                <Box>
                    <Typography variant="h6">Special buckets</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Travel, a hackathon: in their time frame, the regular buckets give way to them.
                    </Typography>
                </Box>
                <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddingSpecial(true)}>
                    Add special bucket
                </Button>
            </Box>
            <Paper>
                <List>
                    {specials.map(bucketType => (
                        <ListItem key={bucketType.id} divider onClick={() => setEditBucket(bucketType)}
                            sx={{ cursor: 'pointer' }}>
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: bucketType.hex_color || '#ccc' }} />
                                        <Typography variant="subtitle1">{bucketType.name}</Typography>
                                        {bucketType.tags.map(tag => (
                                            <Chip key={tag.id} label={`#${tag.name}`} size="small" sx={{ bgcolor: tag.hex_color, color: '#fff' }} />
                                        ))}
                                        {bucketType.calendar && <Chip size="small" variant="outlined" label={bucketType.calendar.name} />}
                                    </Box>
                                }
                                secondary={`${frame(bucketType)}${bucketType.start_times
                                    ? ` · ${bucketType.start_times} · ${formatDuration(bucketType.duration)}` : ' · the whole time'}`}
                            />
                        </ListItem>
                    ))}
                    {specials.length === 0 && (
                        <ListItem>
                            <Typography variant="body2" color="text.secondary">
                                No special buckets. A marker in the Week view can become one, too.
                            </Typography>
                        </ListItem>
                    )}
                </List>
            </Paper>
            <Fab
                color="primary" aria-label="Add bucket"
                onClick={() => setAdding(true)}
                sx={{ position: 'fixed', bottom: 32, right: 32 }}
            >
                <AddIcon />
            </Fab>
            {(adding || editBucket) && (
                <BucketTypeFormDialog open onClose={close} bucketType={editBucket ?? undefined} />
            )}
            {addingSpecial && (
                <BucketTypeFormDialog open onClose={close}
                    special={{ start: tomorrow, end: new Date(tomorrow.getTime() + 24 * 3600 * 1000) }} />
            )}
        </Box>
    );
}
