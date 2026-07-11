import { useState } from 'react';
import { Alert, AlertTitle, Button, Stack } from '@mui/material';
import { format } from 'date-fns';

import { useProjects, useTasks } from '../queries';
import type { PlanWarning } from '../types';
import { TaskFormDialog } from './TaskFormDialog';
import { BucketTypeFormDialog } from './BucketTypeFormDialog';

/**
 * WP-13: the accepted plan's feasibility warnings, surfaced globally with
 * the three remedies from §3: add capacity, renegotiate the deadline, or
 * reprioritize (the latter two open the task form on the affected task).
 */
export function FeasibilityBanner({ warnings }: { warnings: PlanWarning[] }) {
    const tasks = useTasks();
    const projects = useProjects();
    const [bucketFormOpen, setBucketFormOpen] = useState(false);
    const [editTaskId, setEditTaskId] = useState<string | null>(null);

    if (warnings.length === 0) return null;

    const describe = (warning: PlanWarning): string => {
        const task = tasks.data?.find(t => t.id === warning.task_id);
        const project = projects.data?.find(p => p.id === task?.project_id);
        const subject = project
            ? `Project “${project.name}” (task “${warning.header}”)`
            : `“${warning.header}”`;
        if (warning.kind === 'deadline_missed' && warning.deadline) {
            const projected = warning.projected_finish
                ? `, projected ${format(new Date(warning.projected_finish), 'MMM d, HH:mm')}`
                : '';
            return `${subject} can't finish by ${format(new Date(warning.deadline), 'MMM d')}${projected}.`;
        }
        return `${subject} doesn't fit within the planning horizon.`;
    };

    const editingTask = tasks.data?.find(t => t.id === editTaskId);

    return (
        <>
            {warnings.map(warning => (
                <Alert
                    key={`${warning.task_id}-${warning.kind}`}
                    severity="warning" sx={{ mb: 1 }}
                >
                    <AlertTitle>{describe(warning)}</AlertTitle>
                    <Stack direction="row" spacing={1}>
                        <Button size="small" color="inherit" variant="outlined"
                            onClick={() => setBucketFormOpen(true)}>
                            Add time buckets
                        </Button>
                        <Button size="small" color="inherit" variant="outlined"
                            onClick={() => setEditTaskId(warning.task_id)}>
                            Edit deadline
                        </Button>
                        <Button size="small" color="inherit" variant="outlined"
                            onClick={() => setEditTaskId(warning.task_id)}>
                            Edit priority
                        </Button>
                    </Stack>
                </Alert>
            ))}
            {bucketFormOpen && (
                <BucketTypeFormDialog open onClose={() => setBucketFormOpen(false)} />
            )}
            {editingTask && (
                <TaskFormDialog open task={editingTask} onClose={() => setEditTaskId(null)} />
            )}
        </>
    );
}
