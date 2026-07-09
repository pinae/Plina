import { useMemo } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useDependencies, useProjects, useTasks } from '../queries';
import { buildFlowGraph } from '../utils/dependencyGraph';
import { nodeTypes } from './TaskNode';

/**
 * WP-8: read-only visualization of the dependency DAG.
 * Editing (drag-to-connect, deletion, inline task creation) arrives in WP-9.
 */
export default function DependencyEditor() {
    const tasks = useTasks();
    const dependencies = useDependencies();
    const projects = useProjects();

    const graph = useMemo(
        () => buildFlowGraph(
            tasks.data ?? [], dependencies.data ?? [], projects.data ?? [],
        ),
        [tasks.data, dependencies.data, projects.data],
    );

    if (tasks.isPending || dependencies.isPending || projects.isPending) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }
    if (tasks.isError || dependencies.isError || projects.isError) {
        return <Alert severity="error">Could not load the dependency graph.</Alert>;
    }

    return (
        <Box sx={{ height: '75vh', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Typography variant="h5" sx={{ p: 1 }}>Dependencies</Typography>
            <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.2}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={24} />
                <MiniMap pannable zoomable />
                <Controls showInteractive={false} />
            </ReactFlow>
        </Box>
    );
}
