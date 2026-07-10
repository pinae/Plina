import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, Snackbar, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import {
    Background, Controls, MiniMap, Panel, ReactFlow,
    useEdgesState, useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useDependencies, useProjects, useTasks } from '../queries';
import { useDependencyEditing } from '../hooks/useDependencyEditing';
import { applyCycleHighlight, buildFlowGraph, type TaskFlowNode } from '../utils/dependencyGraph';
import type { Edge } from '@xyflow/react';
import { nodeTypes } from './TaskNode';
import { TaskFormDialog } from './TaskFormDialog';

/**
 * WP-8/9: the dependency graph editor.
 *
 * Data flows one way: server → React Query cache → buildFlowGraph →
 * local React Flow state.  Edits go the other way through mutations
 * (optimistic for creation), and invalidation closes the loop.
 */
export default function DependencyEditor() {
    const tasks = useTasks();
    const dependencies = useDependencies();
    const projects = useProjects();
    const editing = useDependencyEditing();
    const [addOpen, setAddOpen] = useState(false);
    const colorMode = useTheme().palette.mode;

    const graph = useMemo(() => {
        const built = buildFlowGraph(
            tasks.data ?? [], dependencies.data ?? [], projects.data ?? [],
        );
        return applyCycleHighlight(built.nodes, built.edges, editing.cyclePath);
    }, [tasks.data, dependencies.data, projects.data, editing.cyclePath]);

    const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    useEffect(() => setNodes(graph.nodes), [graph.nodes, setNodes]);
    useEffect(() => setEdges(graph.edges), [graph.edges, setEdges]);

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
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={editing.onConnect}
                onEdgesDelete={editing.onEdgesDelete}
                colorMode={colorMode}
                deleteKeyCode={['Backspace', 'Delete']}
                nodesDraggable
                nodesConnectable
                elementsSelectable
                fitView
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={24} />
                <MiniMap pannable zoomable />
                <Controls showInteractive={false} />
                <Panel position="top-right">
                    <Button
                        variant="contained" size="small" startIcon={<AddIcon />}
                        onClick={() => setAddOpen(true)}
                    >
                        Add task
                    </Button>
                </Panel>
            </ReactFlow>
            {addOpen && <TaskFormDialog open onClose={() => setAddOpen(false)} />}
            <Snackbar
                open={editing.toast !== null}
                autoHideDuration={6000}
                onClose={() => { editing.clearToast(); editing.clearCycle(); }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity="error" variant="filled"
                    onClose={() => { editing.clearToast(); editing.clearCycle(); }}
                >
                    {editing.toast}
                </Alert>
            </Snackbar>
        </Box>
    );
}
