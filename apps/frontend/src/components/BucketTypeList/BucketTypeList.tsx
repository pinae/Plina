import { useState } from 'react';
import {
    Box, Chip, Fab, List, ListItem, ListItemText, Paper, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { useBucketTypes } from '../../queries.tsx';
import { formatDuration } from '../../utils/duration.ts';
import { BucketTypeFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';

/** The "Time Buckets" pane: the existing bucket types plus one floating add button. */
export default function BucketTypeList() {
    const bucketTypesQuery = useBucketTypes();
    const bucketTypes = bucketTypesQuery.data ?? [];
    const [open, setOpen] = useState(false);

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Time Buckets
            </Typography>
            <Paper>
                <List>
                    {bucketTypes.map(bucketType => (
                        <ListItem key={bucketType.id} divider>
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
            <Fab
                color="primary" aria-label="Add bucket type"
                onClick={() => setOpen(true)}
                sx={{ position: 'fixed', bottom: 32, right: 32 }}
            >
                <AddIcon />
            </Fab>
            {open && <BucketTypeFormDialog open onClose={() => setOpen(false)} />}
        </Box>
    );
}
