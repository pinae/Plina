import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, FormControlLabel, Snackbar, Switch, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import {
    Background, Controls, MiniMap, Panel, ReactFlow,
    useEdgesState, useNodesState, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useDependencies, useSettings, useTags, useTasks } from '../../queries.tsx';
import { useDependencyEditing } from '../../hooks/useDependencyEditing.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';
import { useTaskFilter } from '../../hooks/useTaskFilter.ts';
import { applyCycleHighlight, buildFlowGraph, filterGraph, type TaskFlowNode } from '../../utils/dependencyGraph.ts';
import { parseDurationMinutes } from '../../utils/duration.ts';
import { projectOptions } from '../../utils/projects.ts';
import { withoutLaterOccurrences } from '../../utils/recurring.ts';
import { EMPTY_FILTER, filterTasks, isFiltering } from '../../utils/taskFilter.ts';
import { readShowLinked, storeShowLinked } from '../../utils/taskTreePrefs.ts';
import type { Edge } from '@xyflow/react';
import { TaskNode } from '../TaskNode/TaskNode.tsx';
import { TaskFilterBar } from '../TaskFilterBar/TaskFilterBar.tsx';
import { TaskFormDialog } from '../TaskFormDialog/TaskFormDialog.tsx';

// Module level: React Flow needs the same object on every render.
const nodeTypes = { task: TaskNode };
/** A few tasks left by a filter are not blown up beyond readable size. */
const FIT_OPTIONS = { padding: 0.15, maxZoom: 1.1 };
/** Phones: not shrunk below readable size either — pan, or filter. */
const PHONE_FIT_OPTIONS = { ...FIT_OPTIONS, minZoom: 0.5 };

/**
 * WP-8/9: the dependency graph editor.
 *
 * Data flows one way: server → React Query cache → buildFlowGraph →
 * local React Flow state.  Edits go the other way through mutations
 * (optimistic for creation), and invalidation closes the loop.
 *
 * The filter bar of the Tasks tab (README: Filtering tasks; the same filter)
 * narrows the graph to the tasks that pass, laid out anew and fitted into
 * view; "Show linked tasks" adds the tasks one dependency away, greyed.
 */
export default function DependencyEditor() {
    const tasks = useTasks();
    const tags = useTags();
    const settings = useSettings();
    const dependencies = useDependencies();
    const editing = useDependencyEditing();
    const [addOpen, setAddOpen] = useState(false);
    const colorMode = useTheme().palette.mode;
    const mobile = useIsMobile();
    const [filter, setFilter] = useTaskFilter();
    const filtering = isFiltering(filter);
    const [showLinked, setShowLinked] = useState(readShowLinked);

    // A recurring appointment's occurrences ahead: only the next one.
    const allTasks = useMemo(() => withoutLaterOccurrences(tasks.data ?? [], new Date()), [tasks.data]);
    const activeId = settings.data?.active_task_id ?? null;
    const defaultMinutes = parseDurationMinutes(settings.data?.default_duration ?? null) ?? 60;
    const matching = useMemo(() => (filtering
        ? filterTasks(allTasks, filter, { activeId, defaultMinutes }).matching : null),
    [filtering, allTasks, filter, activeId, defaultMinutes]);
    const shown = useMemo(() => (matching
        ? filterGraph(allTasks, dependencies.data ?? [], matching, showLinked)
        : { tasks: allTasks, linked: new Set<string>() }),
    [matching, allTasks, dependencies.data, showLinked]);

    const graph = useMemo(() => {
        const built = buildFlowGraph(shown.tasks, dependencies.data ?? [], shown.linked);
        return applyCycleHighlight(built.nodes, built.edges, editing.cyclePath);
    }, [shown, dependencies.data, editing.cyclePath]);
    // Fit the graph into view whenever the filter changes what is shown.
    const shownKey = useMemo(() => shown.tasks.map(task => task.id).sort().join(','), [shown.tasks]);

    const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    useEffect(() => setNodes(graph.nodes), [graph.nodes, setNodes]);
    useEffect(() => setEdges(graph.edges), [graph.edges, setEdges]);

    if (tasks.isPending || dependencies.isPending) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }
    if (tasks.isError || dependencies.isError) {
        return <Alert severity="error">Could not load the dependency graph.</Alert>;
    }

    const linkedSwitch = (
        <FormControlLabel sx={{ ml: mobile ? 0 : 'auto' }}
            control={<Switch size="small" checked={showLinked}
                onChange={event => { setShowLinked(event.target.checked); storeShowLinked(event.target.checked); }} />}
            label={<Typography variant="body2">Show linked tasks</Typography>} />
    );

    return (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1, p: mobile ? 1 : 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="h5" component="h1">Dependencies</Typography>
                {!mobile && linkedSwitch}
            </Box>
            <TaskFilterBar filter={filter} onChange={setFilter}
                projects={projectOptions(allTasks)} tags={tags.data ?? []}
                matchCount={matching ? matching.size : allTasks.length} totalCount={allTasks.length}
                sheetExtras={mobile ? linkedSwitch : undefined} />
            <Box sx={{
                flex: 1, minHeight: mobile ? 380 : 480, position: 'relative',
                border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden',
            }}>
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
                fitViewOptions={mobile ? PHONE_FIT_OPTIONS : FIT_OPTIONS}
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
            >
                <FitOnChange shownKey={shownKey} options={mobile ? PHONE_FIT_OPTIONS : FIT_OPTIONS} />
                <Background gap={24} />
                {!mobile && <MiniMap pannable zoomable />}
                <Controls showInteractive={false} />
                {filtering && matching?.size === 0 && (
                    <Panel position="top-center">
                        <Alert severity="info" action={(
                            <Button color="inherit" size="small" onClick={() => setFilter(EMPTY_FILTER)}>Clear filter</Button>
                        )}>
                            No tasks match the filter.
                        </Alert>
                    </Panel>
                )}
                <Panel position="top-right">
                    <Button
                        variant="contained" size="small" startIcon={<AddIcon />}
                        onClick={() => setAddOpen(true)}
                    >
                        Add task
                    </Button>
                </Panel>
            </ReactFlow>
            </Box>
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

/** Fits the graph into view when the shown tasks change (a filter); the
 *  first fit is ``fitView`` on mount. */
function FitOnChange({ shownKey, options }: { shownKey: string; options: typeof FIT_OPTIONS }) {
    const { fitView } = useReactFlow();
    const fitted = useRef(shownKey);
    useEffect(() => {
        if (shownKey === fitted.current) return;
        fitted.current = shownKey;
        // After React Flow has measured the new nodes.
        const frame = requestAnimationFrame(() => { fitView({ ...options, duration: 200 }); });
        return () => cancelAnimationFrame(frame);
    }, [shownKey, options, fitView]);
    return null;
}
