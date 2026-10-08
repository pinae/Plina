/**
 * WP-8: pure construction of the React Flow graph from API data.
 *
 * Kept free of React so the layout is unit-testable: tasks + dependencies
 * in, positioned nodes and edges out. The color bar shows the project, i.e.
 * the top-level ancestor (UI-1: projects are top-level tasks).
 */
import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

import type { Dependency, Task } from '../types';
import { formatDuration } from './duration';

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 76;

export interface TaskNodeData extends Record<string, unknown> {
    header: string;
    durationLabel: string;
    /** The color the task shows (§4.4): its own, else inherited. */
    color: string | null;
    projectName: string | null;
    isDone: boolean;
    inCycle?: boolean;
    /** Filtered: shown only as a direct link of a task that passes (greyed). */
    dimmed?: boolean;
}

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

/** The task's project: its top-level ancestor, or the task itself when it
 *  is a top-level task with subtasks. A single top-level step has none. */
function projectOf(task: Task, byId: Map<string, Task>): Task | null {
    const rootId = task.ancestor_ids?.[0];
    if (rootId) return byId.get(rootId) ?? null;
    return task.children_ids?.length ? task : null;
}

/** Gaps of the grid of tasks without dependencies. */
const GRID_GAP_X = 28;
const GRID_GAP_Y = 24;

/** dagre for the tasks with dependencies (left to right); the tasks without
 *  any go below in a grid as wide as that graph — not one tall column, which
 *  would shrink everything when fitted into view (phones above all). */
function layout(nodes: TaskFlowNode[], edges: Edge[]): TaskFlowNode[] {
    const linked = new Set(edges.flatMap(edge => [edge.source, edge.target]));
    const connected = nodes.filter(node => linked.has(node.id));
    const isolated = nodes.filter(node => !linked.has(node.id));
    const positions = new Map<string, { x: number; y: number }>();

    if (connected.length) {
        const graph = new dagre.graphlib.Graph();
        graph.setDefaultEdgeLabel(() => ({}));
        graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 70 });
        for (const node of connected) {
            graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
        }
        for (const edge of edges) {
            graph.setEdge(edge.source, edge.target);
        }
        dagre.layout(graph);
        for (const node of connected) {
            const { x, y } = graph.node(node.id);
            // dagre positions node centers; React Flow expects top-left corners.
            positions.set(node.id, { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 });
        }
    }

    if (isolated.length) {
        const placed = [...positions.values()];
        const left = placed.length ? Math.min(...placed.map(p => p.x)) : 0;
        const width = placed.length ? Math.max(...placed.map(p => p.x)) + NODE_WIDTH - left : 0;
        const top = placed.length ? Math.max(...placed.map(p => p.y)) + NODE_HEIGHT + 3 * GRID_GAP_Y : 0;
        const fitting = Math.floor((width + GRID_GAP_X) / (NODE_WIDTH + GRID_GAP_X));
        const columns = Math.min(isolated.length, Math.max(fitting, Math.ceil(Math.sqrt(isolated.length))));
        isolated.forEach((node, index) => positions.set(node.id, {
            x: left + (index % columns) * (NODE_WIDTH + GRID_GAP_X),
            y: top + Math.floor(index / columns) * (NODE_HEIGHT + GRID_GAP_Y),
        }));
    }

    return nodes.map(node => ({ ...node, position: positions.get(node.id)! }));
}

export function buildFlowGraph(
    tasks: Task[],
    dependencies: Dependency[],
    /** Tasks shown greyed (the filter's linked tasks). */
    dimmed: Set<string> = new Set(),
): { nodes: TaskFlowNode[]; edges: Edge[] } {
    const byId = new Map(tasks.map(task => [task.id, task]));

    const nodes: TaskFlowNode[] = tasks.map(task => {
        const project = projectOf(task, byId);
        return {
            id: task.id,
            type: 'task',
            position: { x: 0, y: 0 },
            data: {
                header: task.header,
                durationLabel: formatDuration(task.duration),
                color: task.hex_color ?? null,
                projectName: project?.header ?? null,
                isDone: task.is_done,
                ...(dimmed.has(task.id) ? { dimmed: true } : {}),
            },
        };
    });

    const known = new Set(tasks.map(task => task.id));
    const edges: Edge[] = dependencies
        .filter(dep => known.has(dep.predecessor) && known.has(dep.successor))
        .map(dep => ({
            id: dep.id,
            source: dep.predecessor,
            target: dep.successor,
            markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
            // Optimistic edges (not yet persisted) animate until confirmed.
            animated: dep.id.startsWith('optimistic-'),
            // Between two greyed tasks: greyed too.
            ...(dimmed.has(dep.predecessor) && dimmed.has(dep.successor) ? { style: { opacity: 0.35 } } : {}),
        }));

    return { nodes: layout(nodes, edges), edges };
}

const CYCLE_COLOR = '#d32f2f';

/** Marks the nodes on `cyclePath` and the edges connecting consecutive
 *  members red, so the user sees exactly the loop the server rejected. */
export function applyCycleHighlight(
    nodes: TaskFlowNode[],
    edges: Edge[],
    cyclePath: string[] | null,
): { nodes: TaskFlowNode[]; edges: Edge[] } {
    if (!cyclePath || cyclePath.length === 0) return { nodes, edges };
    const members = new Set(cyclePath);
    const pairs = new Set(
        cyclePath.slice(0, -1).map((id, i) => `${id}->${cyclePath[i + 1]}`),
    );
    return {
        nodes: nodes.map(node =>
            members.has(node.id)
                ? { ...node, data: { ...node.data, inCycle: true } }
                : node,
        ),
        edges: edges.map(edge =>
            pairs.has(`${edge.source}->${edge.target}`)
                ? {
                    ...edge,
                    animated: true,
                    style: { ...edge.style, stroke: CYCLE_COLOR, strokeWidth: 2.5 },
                }
                : edge,
        ),
    };
}

export interface GraphFilter {
    /** The tasks shown: those that pass and, with ``showLinked``, their links. */
    tasks: Task[];
    /** The linked tasks that do not pass themselves: greyed. */
    linked: Set<string>;
}

/** The filtered graph (README: Filtering tasks): the tasks that pass and,
 *  with ``showLinked``, the tasks one dependency away — so a chain stays
 *  readable at its ends. */
export function filterGraph(
    tasks: Task[], dependencies: Dependency[], matching: Set<string>, showLinked: boolean,
): GraphFilter {
    const linked = new Set<string>();
    if (showLinked) {
        for (const dep of dependencies) {
            if (matching.has(dep.predecessor) && !matching.has(dep.successor)) linked.add(dep.successor);
            if (matching.has(dep.successor) && !matching.has(dep.predecessor)) linked.add(dep.predecessor);
        }
    }
    return { tasks: tasks.filter(task => matching.has(task.id) || linked.has(task.id)), linked };
}
