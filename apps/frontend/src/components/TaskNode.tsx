import { memo } from 'react';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import type { TaskFlowNode } from '../utils/dependencyGraph';
import { NODE_HEIGHT, NODE_WIDTH } from '../utils/dependencyGraph';

export interface TaskNodeCardProps {
    header: string;
    durationLabel: string;
    projectColor: string | null;
    projectName: string | null;
    isDone: boolean;
    inCycle?: boolean;
}

/** Pure presentational card — rendered inside the flow node and unit-tested
 *  standalone (React Flow context not required). */
export function TaskNodeCard({
    header, durationLabel, projectColor, projectName, isDone, inCycle = false,
}: TaskNodeCardProps) {
    return (
        <Box
            data-testid="task-node-card"
            data-in-cycle={inCycle ? 'true' : 'false'}
            sx={{
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                display: 'flex',
                borderRadius: 1.5,
                overflow: 'hidden',
                bgcolor: 'background.paper',
                border: inCycle ? 2 : 1,
                borderColor: inCycle ? 'error.main' : 'divider',
                boxShadow: 1,
                opacity: isDone ? 0.45 : 1,
            }}
        >
            <Tooltip title={projectName ?? 'No project'}>
                <Box
                    data-testid="project-color-bar"
                    sx={{
                        width: 6,
                        flexShrink: 0,
                        backgroundColor: projectColor ?? '#b0b0b0',
                    }}
                />
            </Tooltip>
            <Box sx={{ p: 1, minWidth: 0, flexGrow: 1 }}>
                <Typography
                    variant="subtitle2"
                    noWrap
                    sx={{ textDecoration: isDone ? 'line-through' : 'none' }}
                >
                    {header}
                </Typography>
                <Chip label={durationLabel} size="small" sx={{ mt: 0.5 }} />
            </Box>
        </Box>
    );
}

/** The React Flow node: card plus finish-to-start handles (in left, out right). */
function TaskNodeComponent({ data }: NodeProps<TaskFlowNode>) {
    return (
        <>
            <Handle type="target" position={Position.Left} />
            <TaskNodeCard {...data} />
            <Handle type="source" position={Position.Right} />
        </>
    );
}

export const TaskNode = memo(TaskNodeComponent);

export const nodeTypes = { task: TaskNode };
