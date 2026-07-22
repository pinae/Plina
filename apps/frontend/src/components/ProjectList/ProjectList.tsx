import { useState } from 'react';
import {
    Box, Chip, Fab, List, ListItem, ListItemText, Paper, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { useProjects } from '../../queries.tsx';
import { ProjectFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';

/** The "Projects" pane: the existing projects plus one floating add button. */
export default function ProjectList() {
    const projectsQuery = useProjects();
    const projects = projectsQuery.data ?? [];
    const [open, setOpen] = useState(false);

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Projects
            </Typography>
            <Paper>
                <List>
                    {projects.map(project => (
                        <ListItem key={project.id} divider>
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: project.hex_color || '#ccc' }} />
                                        <Typography variant="subtitle1">{project.name}</Typography>
                                        {project.tags.map(tag => (
                                            <Chip key={tag.id} label={`#${tag.name}`} size="small" sx={{ bgcolor: tag.hex_color, color: '#fff' }} />
                                        ))}
                                    </Box>
                                }
                                secondary={
                                    <>
                                        <Typography variant="body2" component="span">
                                            Priority: {project.priority.toFixed(1)}
                                        </Typography>
                                        {project.description && (
                                            <Typography variant="body2" component="span"> · {project.description}</Typography>
                                        )}
                                    </>
                                }
                            />
                        </ListItem>
                    ))}
                    {projects.length === 0 && (
                        <ListItem>
                            <Typography variant="body2" color="text.secondary">
                                No projects yet.
                            </Typography>
                        </ListItem>
                    )}
                </List>
            </Paper>
            <Fab
                color="primary" aria-label="Add project"
                onClick={() => setOpen(true)}
                sx={{ position: 'fixed', bottom: 32, right: 32 }}
            >
                <AddIcon />
            </Fab>
            {open && <ProjectFormDialog open onClose={() => setOpen(false)} />}
        </Box>
    );
}
