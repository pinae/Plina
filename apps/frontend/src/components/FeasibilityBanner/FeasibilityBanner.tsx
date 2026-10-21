import { useState } from 'react';
import { Alert, AlertTitle, Button, Stack } from '@mui/material';
import { format } from 'date-fns';

import { useTasks } from '../../queries.tsx';
import type { PlanWarning } from '../../types.ts';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';
import { BucketTypeFormDialog } from '../BucketTypeFormDialog/BucketTypeFormDialog.tsx';
import { whyUnplanned } from '../../utils/planWarnings.ts';

/**
 * WP-13: the accepted plan's feasibility warnings, surfaced globally with
 * the three remedies from §3: add capacity, renegotiate the deadline, or
 * reprioritize (the latter two open the task form on the affected task).
 */
export function FeasibilityBanner({ warnings }: { warnings: PlanWarning[] }) {
    const tasks = useTasks();
    const [bucketFormOpen, setBucketFormOpen] = useState(false);
    const [editTaskId, setEditTaskId] = useState<string | null>(null);

    if (warnings.length === 0) return null;

    const describe = (warning: PlanWarning): string => {
        const task = tasks.data?.find(t => t.id === warning.task_id);
        // The project is the top-level task above it (UI-1).
        const rootId = task?.ancestor_ids?.[0];
        const project = rootId ? tasks.data?.find(t => t.id === rootId) : undefined;
        const subject = project
            ? `Project “${project.header}” (task “${warning.header}”)`
            : `“${warning.header}”`;
        if (warning.kind === 'deadline_missed' && warning.deadline) {
            const projected = warning.projected_finish
                ? `, projected ${format(new Date(warning.projected_finish), 'MMM d, HH:mm')}`
                : '';
            return `${subject} can't finish by ${format(new Date(warning.deadline), 'MMM d')}${projected}.`;
        }
        return `${subject}${warning.missing_minutes === undefined ? '' : ':'} ${whyUnplanned(warning)}.`;
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
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        <Button size="small" color="inherit" variant="outlined"
                            onClick={() => setBucketFormOpen(true)}>
                            Add time buckets
                        </Button>
                        {(warning.kind === 'deadline_missed' || warning.deadline) && (
                            <Button size="small" color="inherit" variant="outlined"
                                onClick={() => setEditTaskId(warning.task_id)}>
                                Edit deadline
                            </Button>
                        )}
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
