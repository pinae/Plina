import React, { useEffect, useState } from 'react';
import { Typography, Paper, List, ListItem, ListItemText, Chip, Box } from '@mui/material';
import api from '../api';

interface Tag {
    id: string;
    name: string;
    hex_color: string;
}

interface Task {
    id: string;
    header: string;
    description: string;
    priority: number;
    tags: Tag[];
    hex_color: string;
    start_date: string | null;
    duration: string | null;
    latest_finish_date: string | null;
}

export default function TaskList() {
    const [tasks, setTasks] = useState<Task[]>([]);

    useEffect(() => {
        api.get('tasks/')
            .then(response => {
                setTasks(response.data);
            })
            .catch(error => {
                console.error("Error fetching tasks:", error);
            });
    }, []);

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Task List
            </Typography>
            <Paper>
                <List>
                    {tasks.map(task => (
                        <ListItem key={task.id} divider>
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
