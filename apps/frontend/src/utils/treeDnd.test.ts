import { describe, expect, it } from 'vitest';

import { applyMove, indentMove, neighbourMove, outdentMove, projectDrop } from './treeDnd.ts';
import { outlineItems } from './outlineTree.ts';
import { makeTask } from '../testing/treeFixtures.ts';
import type { Task } from '../types.ts';

const INDENT = 24;

// T250 › Hardware Design › CAD, test prints ; T250 › Firmware ; Blog › Article ; Milk
const tree = (): Task[] => [
    makeTask('t250', { header: 'T250', order: 0, children_ids: ['hw', 'fw'], rest: '02:00:00' }),
    makeTask('hw', { header: 'Hardware Design', parent_id: 't250', ancestor_ids: ['t250'], order: 0, children_ids: ['cad', 'prints'] }),
    makeTask('cad', { header: 'CAD', parent_id: 'hw', ancestor_ids: ['t250', 'hw'], order: 0 }),
    makeTask('prints', { header: 'test prints', parent_id: 'hw', ancestor_ids: ['t250', 'hw'], order: 1 }),
    makeTask('fw', { header: 'Firmware', parent_id: 't250', ancestor_ids: ['t250'], order: 1 }),
    makeTask('blog', { header: 'Blog', order: 1, children_ids: ['article'] }),
    makeTask('article', { header: 'Article', parent_id: 'blog', ancestor_ids: ['blog'], order: 0 }),
    makeTask('milk', { header: 'Milk', order: 2 }),
];
const rows = (tasks: Task[], collapsed: string[] = []) =>
    outlineItems(tasks, { activeId: null, collapsed: new Set(collapsed), showCompleted: false });
const project = (tasks: Task[], active: string, over: string, indents = 0, collapsed: string[] = []) =>
    projectDrop(rows(tasks, collapsed), tasks, active, over, indents * INDENT, INDENT);

describe('projectDrop (where a dragged row lands)', () => {
    it('reorders within a level', () => {
        expect(project(tree(), 'prints', 'cad')).toMatchObject({ parentId: 'hw', index: 0, depth: 2, changed: true });
    });

    it('moving right makes it a subtask of the row above', () => {
        expect(project(tree(), 'fw', 'fw', 1)).toMatchObject({ parentId: 'hw', index: 2, depth: 2 });
    });

    it('moving left lifts it one level, right after its old parent', () => {
        expect(project(tree(), 'prints', 'prints', -1)).toMatchObject({ parentId: 't250', index: 1, depth: 1 });
    });

    it('can go to the top level', () => {
        expect(project(tree(), 'article', 'article', -1)).toMatchObject({ parentId: null, index: 2, depth: 0 });
    });

    it('can go into a task without subtasks', () => {
        const tasks = tree().filter(t => t.id !== 'article').map(t => (t.id === 'blog' ? { ...t, children_ids: [] } : t));
        expect(project(tasks, 'milk', 'milk', 1)).toMatchObject({ parentId: 'blog', index: 0, depth: 1 });
    });

    it('clamps the depth to what the neighbours allow', () => {
        // Far to the right: at most one level deeper than the row above.
        expect(project(tree(), 'fw', 'fw', 5)).toMatchObject({ parentId: 'prints', depth: 3, index: 0 });
        // Far to the left: not shallower than the row below.
        expect(project(tree(), 'cad', 'cad', -5)).toMatchObject({ depth: 2, parentId: 'hw' });
    });

    it('cannot land inside its own subtree', () => {
        expect(project(tree(), 'hw', 'cad')).toBeNull();
    });

    it('appends to a collapsed parent instead of slipping before its hidden subtasks', () => {
        expect(project(tree(), 'fw', 'fw', 1, ['hw'])).toMatchObject({ parentId: 'hw', index: 2 });
    });

    it('does not nest under a completed task', () => {
        const tasks = tree().map(t => (t.id === 'prints' ? { ...t, is_done: true, completed_at: '2026-09-01T00:00:00Z' } : t));
        const shown = outlineItems(tasks, { activeId: null, collapsed: new Set(), showCompleted: true });
        // Two levels right would nest under the completed "test prints": it
        // becomes its sibling instead.
        expect(projectDrop(shown, tasks, 'fw', 'fw', 2 * INDENT, INDENT)).toMatchObject({ depth: 2, parentId: 'hw' });
    });

    it('counts hidden completed siblings for the position', () => {
        const tasks = [...tree(), makeTask('parts', { header: 'parts', parent_id: 'hw', ancestor_ids: ['t250', 'hw'], order: 2,
            is_done: true, completed_at: '2026-09-01T00:00:00Z' })];
        // After "test prints" (index 1 of cad, prints, parts) — before the hidden one.
        expect(project(tasks, 'fw', 'fw', 1)).toMatchObject({ parentId: 'hw', index: 2 });
    });

    it('reports an unchanged position', () => {
        expect(project(tree(), 'prints', 'prints')).toMatchObject({ parentId: 'hw', index: 1, changed: false });
    });
});

describe('applyMove (optimistic tree update)', () => {
    const byId = (tasks: Task[]) => new Map(tasks.map(t => [t.id, t]));

    it('re-parents and renumbers both sibling lists', () => {
        const moved = byId(applyMove(tree(), 'fw', 'hw', 1));
        expect(moved.get('fw')).toMatchObject({ parent_id: 'hw', order: 1, ancestor_ids: ['t250', 'hw'] });
        expect(['cad', 'fw', 'prints'].map(id => moved.get(id)!.order)).toEqual([0, 1, 2]);
        expect(moved.get('hw')!.children_ids).toEqual(['cad', 'fw', 'prints']);
        expect(moved.get('t250')!.children_ids).toEqual(['hw']);
    });

    it('updates the ancestors of the moved subtree', () => {
        const moved = byId(applyMove(tree(), 'hw', null, 0));
        expect(moved.get('hw')).toMatchObject({ parent_id: null, ancestor_ids: [], order: 0 });
        expect(moved.get('cad')!.ancestor_ids).toEqual(['hw']);
        expect(['hw', 't250', 'blog', 'milk'].map(id => moved.get(id)!.order)).toEqual([0, 1, 2, 3]);
    });
});

describe('keyboard / row-button moves (Tab, Shift+Tab, Alt+↑/↓)', () => {
    it('indent: into the previous sibling, at its end', () => {
        expect(indentMove(tree(), 'fw')).toEqual({ parentId: 'hw', index: 2 });
        expect(indentMove(tree(), 'cad')).toBeNull(); // first child: no sibling above
    });

    it('outdent: right after the old parent', () => {
        expect(outdentMove(tree(), 'cad')).toEqual({ parentId: 't250', index: 1 });
        expect(outdentMove(tree(), 'blog')).toBeNull(); // already top level
    });

    it('up/down: past the neighbouring open sibling', () => {
        expect(neighbourMove(tree(), 'cad', 1)).toEqual({ parentId: 'hw', index: 1 });
        expect(neighbourMove(tree(), 'prints', -1)).toEqual({ parentId: 'hw', index: 0 });
        expect(neighbourMove(tree(), 'cad', -1)).toBeNull();
        expect(neighbourMove(tree(), 'milk', 1)).toBeNull();
    });

    it('up/down skip hidden completed siblings', () => {
        const tasks = tree().map(t => (t.id === 'prints' ? { ...t, order: 2 } : t)).concat(
            makeTask('parts', { header: 'parts', parent_id: 'hw', ancestor_ids: ['t250', 'hw'], order: 1,
                is_done: true, completed_at: '2026-09-01T00:00:00Z' }));
        expect(neighbourMove(tasks, 'cad', 1)).toEqual({ parentId: 'hw', index: 2 }); // after prints
    });
});

