/**
 * WP-8: pure construction of the React Flow graph from API data.
 *
 * Kept free of React so the layout is unit-testable: tasks + dependencies
 * (+ projects for the color bar) in, positioned nodes and edges out.
 */
import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

import type { Dependency, Project, Task } from '../types';
import { formatDuration } from './duration';

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 76;

export interface TaskNodeData extends Record<string, unknown> {
    header: string;
    durationLabel: string;
    projectColor: string | null;
    projectName: string | null;
    isDone: boolean;
    inCycle?: boolean;
}

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

function projectLookup(projects: Project[]): Map<string, Project> {
    const byTask = new Map<string, Project>();
    for (const project of projects) {
        for (const taskId of project.order) {
            byTask.set(taskId, project);
        }
    }
    return byTask;
}

function layout(nodes: TaskFlowNode[], edges: Edge[]): TaskFlowNode[] {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 70 });
    for (const node of nodes) {
        graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const edge of edges) {
        graph.setEdge(edge.source, edge.target);
    }
    dagre.layout(graph);
    return nodes.map(node => {
        const { x, y } = graph.node(node.id);
        // dagre positions node centers; React Flow expects top-left corners.
        return {
            ...node,
            position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
        };
    });
}

export function buildFlowGraph(
    tasks: Task[],
    dependencies: Dependency[],
    projects: Project[],
): { nodes: TaskFlowNode[]; edges: Edge[] } {
    const byTask = projectLookup(projects);

    const nodes: TaskFlowNode[] = tasks.map(task => {
        const project = byTask.get(task.id) ?? null;
        return {
            id: task.id,
            type: 'task',
            position: { x: 0, y: 0 },
            data: {
                header: task.header,
                durationLabel: formatDuration(task.duration),
                projectColor: project?.hex_color ?? null,
                projectName: project?.name ?? null,
                isDone: task.is_done,
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
