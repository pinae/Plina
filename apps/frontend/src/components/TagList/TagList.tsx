import { useState } from 'react';
import { Box, Chip, Fab, List, ListItem, Paper, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { useTags } from '../../queries.tsx';
import type { Tag } from '../../types.ts';
import { TagFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';

/** The "Tags" pane: the existing tags plus one floating add button. */
export default function TagList() {
    const tagsQuery = useTags();
    const tags = tagsQuery.data ?? [];
    const [adding, setAdding] = useState(false);
    const [editTag, setEditTag] = useState<Tag | null>(null);
    const close = () => { setAdding(false); setEditTag(null); };

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Tags
            </Typography>
            <Paper>
                <List>
                    {tags.map(tag => (
                        <ListItem
                            key={tag.id} divider onClick={() => setEditTag(tag)}
                            sx={{ cursor: 'pointer' }}
                        >
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
                onClick={() => setAdding(true)}
                sx={{ position: 'fixed', bottom: 32, right: 32 }}
            >
                <AddIcon />
            </Fab>
            {(adding || editTag) && (
                <TagFormDialog open onClose={close} tag={editTag ?? undefined} />
            )}
        </Box>
    );
}
