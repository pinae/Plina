import { describe, expect, it } from 'vitest';

import { formatDuration } from './duration';
import { buildFlowGraph, NODE_HEIGHT, NODE_WIDTH } from './dependencyGraph';
import type { Dependency, Project, Task } from '../types';

describe('formatDuration', () => {
    it('formats DRF duration strings human-readably', () => {
        expect(formatDuration('02:00:00')).toBe('2h');
        expect(formatDuration('00:30:00')).toBe('30m');
        expect(formatDuration('01:30:00')).toBe('1h 30m');
        expect(formatDuration('1 02:00:00')).toBe('1d 2h');
    });

    it('handles missing durations', () => {
        expect(formatDuration(null)).toBe('—');
    });
});

function task(id: string, header: string, done = false): Task {
    return {
        id, header, description: '', start_date: null, duration: '01:00:00',
        latest_finish_date: null, time_spent: '00:00:00', priority: 5,
        tags: [], hex_color: null, is_fixed: false, is_appointment: false,
        completed_at: done ? '2026-07-01T10:00:00Z' : null, is_done: done,
        active_tracking_start: null,
    };
}

function dependency(id: string, predecessor: string, successor: string): Dependency {
    return { id, predecessor, successor };
}

function project(id: string, name: string, taskIds: string[], color: string): Project {
    return { id, name, description: '', tags: [], priority: 5, order: 0, task_ids: taskIds, hex_color: color };
}

const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;

describe('buildFlowGraph', () => {
    it('lays out a chain strictly left to right', () => {
        const tasks = [task('a', 'A'), task('b', 'B'), task('c', 'C')];
        const deps = [dependency('e1', 'a', 'b'), dependency('e2', 'b', 'c')];

        const { nodes, edges } = buildFlowGraph(tasks, deps, []);

        const x = Object.fromEntries(nodes.map(n => [n.id, n.position.x]));
        expect(x.a).toBeLessThan(x.b);
        expect(x.b).toBeLessThan(x.c);
        expect(edges.map(e => [e.source, e.target])).toEqual([['a', 'b'], ['b', 'c']]);
    });

    it('lays out the demo-shaped DAG without overlapping nodes', () => {
        // A diamond plus a chain — the shapes in populate_demo_data.
        const tasks = ['r', 'l', 'x', 'm', 'c1', 'c2', 'c3'].map(id => task(id, id.toUpperCase()));
        const deps = [
            dependency('e1', 'r', 'l'), dependency('e2', 'r', 'x'),
            dependency('e3', 'l', 'm'), dependency('e4', 'x', 'm'),
            dependency('e5', 'c1', 'c2'), dependency('e6', 'c2', 'c3'),
        ];

        const { nodes } = buildFlowGraph(tasks, deps, []);

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                expect(
                    overlap(nodes[i].position, nodes[j].position),
                    `${nodes[i].id} overlaps ${nodes[j].id}`,
                ).toBe(false);
            }
        }
    });

    it('carries header, duration label, done flag and project color into node data', () => {
        const tasks = [task('a', 'Design Schema'), task('b', 'Old One', true)];
        const projects = [project('p1', 'Webshop', ['a'], '#3357ff')];

        const { nodes } = buildFlowGraph(tasks, [], projects);

        const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
        expect(byId.a.header).toBe('Design Schema');
        expect(byId.a.durationLabel).toBe('1h');
        expect(byId.a.projectColor).toBe('#3357ff');
        expect(byId.a.projectName).toBe('Webshop');
        expect(byId.a.isDone).toBe(false);
        expect(byId.b.isDone).toBe(true);
        expect(byId.b.projectColor).toBeNull();
    });
});


describe('buildFlowGraph with the real project payload (blank-page regression)', () => {
    it('does not crash on the numeric `order` field and maps via task_ids', () => {
        const tasks = [task('a', 'Design Schema')];
        const realProject = {
            id: 'p1', name: 'Webshop', description: '', tags: [],
            priority: 9, order: 0, task_ids: ['a'], hex_color: '#3357ff',
        };

        const { nodes } = buildFlowGraph(tasks, [], [realProject]);

        expect(nodes[0].data.projectColor).toBe('#3357ff');
        expect(nodes[0].data.projectName).toBe('Webshop');
    });

    it('tolerates projects without task_ids instead of crashing', () => {
        const broken = {
            id: 'p1', name: 'Old server', description: '', tags: [],
            priority: 5, order: 0, hex_color: null,
        } as unknown as Project;

        expect(() => buildFlowGraph([task('a', 'A')], [], [broken])).not.toThrow();
    });
});
