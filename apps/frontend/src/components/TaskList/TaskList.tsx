import { useState } from 'react';
import { Typography, Paper, List, ListItem, ListItemText, Chip, Box, Fab } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTasks } from '../../queries.tsx';
import type { Task } from '../../types.ts';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';

/** The "Tasks" pane: the existing tasks plus one floating add button. */
export default function TaskList() {
    const tasksQuery = useTasks();
    const tasks = tasksQuery.data ?? [];
    const [addOpen, setAddOpen] = useState(false);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const close = () => { setAddOpen(false); setEditTask(null); };

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Tasks
            </Typography>
            {(addOpen || editTask !== null) && (
                <TaskFormDialog open onClose={close} task={editTask ?? undefined} />
            )}
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
                    {tasks.length === 0 && (
                        <ListItem>
                            <Typography variant="body2" color="text.secondary">
                                No tasks yet.
                            </Typography>
                        </ListItem>
                    )}
                </List>
            </Paper>
            <Fab
                color="primary" aria-label="Add task"
                onClick={() => setAddOpen(true)}
                sx={{ position: 'fixed', bottom: 32, right: 32 }}
            >
                <AddIcon />
            </Fab>
        </Box>
    );
}
