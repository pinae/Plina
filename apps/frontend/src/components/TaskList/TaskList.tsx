import { useState } from 'react';
import { Typography, Paper, List, ListItem, ListItemText, Chip, Box, Button, Stack } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTasks } from '../../queries.tsx';
import type { Task } from '../../types.ts';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';
import { BucketTypeFormDialog, ProjectFormDialog, TagFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';

export default function TaskList() {
    const tasksQuery = useTasks();
    const tasks = tasksQuery.data ?? [];
    const [dialog, setDialog] = useState<'task' | 'project' | 'tag' | 'bucketType' | null>(null);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const close = () => { setDialog(null); setEditTask(null); };

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Task List
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Button variant="contained" size="small" startIcon={<AddIcon />}
                    onClick={() => setDialog('task')}>Add task</Button>
                <Button variant="outlined" size="small" startIcon={<AddIcon />}
                    onClick={() => setDialog('project')}>Add project</Button>
                <Button variant="outlined" size="small" startIcon={<AddIcon />}
                    onClick={() => setDialog('tag')}>Add tag</Button>
                <Button variant="outlined" size="small" startIcon={<AddIcon />}
                    onClick={() => setDialog('bucketType')}>Add bucket type</Button>
            </Stack>
            {(dialog === 'task' || editTask !== null) && (
                <TaskFormDialog open onClose={close} task={editTask ?? undefined} />
            )}
            {dialog === 'project' && <ProjectFormDialog open onClose={close} />}
            {dialog === 'tag' && <TagFormDialog open onClose={close} />}
            {dialog === 'bucketType' && <BucketTypeFormDialog open onClose={close} />}
            <Paper>
                <List>
                    {tasks.map(task => (
                        <ListItem key={task.id} divider onClick={() => setEditTask(task)} sx={{ cursor: 'pointer' }}>
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: task.hex_color || '#ccc' }} />
                                        <Typography variant="subtitle1">{task.header}</Typography>
                                        {task.tags.map(tag => (
                                            <Chip key={tag.id} label={`#${tag.name}`} size="small" sx={{ bgcolor: tag.hex_color, color: '#fff' }} />
                                        ))}
                                    </Box>
                                }
                                secondary={
                                    <>
                                        <Typography variant="body2" component="span">Priority: {task.priority.toFixed(1)}</Typography>
                                        {task.latest_finish_date && <Typography variant="body2" color="error">Due: {new Date(task.latest_finish_date).toLocaleString()}</Typography>}
                                    </>
                                }
                            />
                        </ListItem>
                    ))}
                </List>
            </Paper>
        </Box>
    );
}
