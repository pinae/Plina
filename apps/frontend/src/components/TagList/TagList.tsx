import { useState } from 'react';
import { Box, Chip, Fab, List, ListItem, Paper, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { useTags } from '../../queries.tsx';
import { TagFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';

/** The "Tags" pane: the existing tags plus one floating add button. */
export default function TagList() {
    const tagsQuery = useTags();
    const tags = tagsQuery.data ?? [];
    const [open, setOpen] = useState(false);

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Tags
            </Typography>
            <Paper>
                <List>
                    {tags.map(tag => (
                        <ListItem key={tag.id} divider>
                            <Chip
                                label={`#${tag.name}`} size="small"
                                sx={{ bgcolor: tag.hex_color, color: '#fff' }}
                            />
                        </ListItem>
                    ))}
                    {tags.length === 0 && (
                        <ListItem>
                            <Typography variant="body2" color="text.secondary">
                                No tags yet.
                            </Typography>
                        </ListItem>
                    )}
                </List>
            </Paper>
            <Fab
                color="primary" aria-label="Add tag"
                onClick={() => setOpen(true)}
                sx={{ position: 'fixed', bottom: 32, right: 32 }}
            >
                <AddIcon />
            </Fab>
            {open && <TagFormDialog open onClose={() => setOpen(false)} />}
        </Box>
    );
}
