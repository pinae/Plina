import { describe, expect, it } from 'vitest';
import { inboxItems, indentParent, outdentParent, outlineItems, reorderPatches } from './outlineTree.ts';
import { makeTask } from '../testing/treeFixtures.ts';
import type { Task } from '../types.ts';

// T250 (rest 4h) › HW (children CAD, prints) ; T250 › FW ; Blog › (none) ; Milk (unestimated)
const tasks = (): Task[] => [
    makeTask('t250', { header: 'T250', order: 0, children_ids: ['hw', 'fw'], rest: '04:00:00' }),
    makeTask('hw', { header: 'Hardware Design', parent_id: 't250', ancestor_ids: ['t250'], order: 0,
        children_ids: ['cad', 'prints'], rest: '00:00:00' }),
    makeTask('cad', { header: 'CAD', parent_id: 'hw', ancestor_ids: ['t250', 'hw'], order: 0 }),
    makeTask('prints', { header: 'test prints', parent_id: 'hw', ancestor_ids: ['t250', 'hw'], order: 1,
        duration: null, is_estimated: false }),
    makeTask('fw', { header: 'Firmware', parent_id: 't250', ancestor_ids: ['t250'], order: 1 }),
    makeTask('blog', { header: 'Blog', order: 1 }),
    makeTask('milk', { header: 'Buy milk', order: 2, duration: null, is_estimated: false }),
    makeTask('old', { header: 'Old', order: 3, is_done: true, completed_at: '2026-01-01T00:00:00Z' }),
];
const labels = (items: ReturnType<typeof outlineItems>) =>
    items.map(i => `${'-'.repeat(i.depth)}${i.kind === 'rest' ? `Rest of ${i.task.header}` : i.task.header}`);

describe('outlineItems', () => {
    const opts = (over: Partial<Parameters<typeof outlineItems>[1]> = {}) =>
        ({ activeId: null, collapsed: new Set<string>(), showCompleted: false, ...over });

    it('lists all open projects as a tree with Rest rows after the children', () => {
        expect(labels(outlineItems(tasks(), opts()))).toEqual([
            'T250', '-Hardware Design', '--CAD', '--test prints', '-Firmware', '-Rest of T250', 'Blog', 'Buy milk',
        ]);
    });

    it('puts the active project\'s top-level task first, the others in their own order (T-3)', () => {
        expect(labels(outlineItems(tasks(), opts({ activeId: 'milk' })))).toEqual([
            'Buy milk', 'T250', '-Hardware Design', '--CAD', '--test prints', '-Firmware', '-Rest of T250', 'Blog',
        ]);
        // An active sub-project brings its whole top-level project to the top.
        const items = outlineItems(tasks(), opts({ activeId: 'hw' }));
        expect(labels(items)[0]).toBe('T250');
    });

    it('marks the active node', () => {
        const items = outlineItems(tasks(), opts({ activeId: 'hw' }));
        const active = items.filter(i => i.kind === 'task' && i.active).map(i => i.task.id);
        expect(active).toEqual(['hw']);
    });

    it('hides the children and the Rest of collapsed rows', () => {
        expect(labels(outlineItems(tasks(), opts({ collapsed: new Set(['t250']) }))))
            .toEqual(['T250', 'Blog', 'Buy milk']);
    });

    it('shows completed tasks in their place only when asked', () => {
        expect(labels(outlineItems(tasks(), opts()))).not.toContain('Old');
        expect(labels(outlineItems(tasks(), opts({ showCompleted: true }))).slice(-1)).toEqual(['Old']);
    });

    it('a parent whose subtasks are all completed has no expander unless completed ones are shown', () => {
        const list = tasks().map(t => (t.id === 'cad' || t.id === 'prints'
            ? { ...t, is_done: true, completed_at: '2026-01-01T00:00:00Z' } : t));
        const hw = (items: ReturnType<typeof outlineItems>) => items.find(i => i.task.id === 'hw' && i.kind === 'task');
        expect(hw(outlineItems(list, opts()))).toMatchObject({ hasChildren: false });
        expect(hw(outlineItems(list, opts({ showCompleted: true })))).toMatchObject({ hasChildren: true });
    });
});

describe('inboxItems', () => {
    it('lists unestimated open tasks from all projects with their path', () => {
        const inbox = inboxItems(tasks());
        expect(inbox.map(i => [i.task.header, i.kind === 'task' ? i.path : ''])).toEqual([
            ['Buy milk', ''], ['test prints', 'T250 › Hardware Design'],
        ]);
    });
});

describe('re-parenting and reordering', () => {
    it('Tab: the previous sibling becomes the parent', () => {
        expect(indentParent(tasks().find(t => t.id === 'fw')!, tasks())).toBe('hw');
        expect(indentParent(tasks().find(t => t.id === 'hw')!, tasks())).toBeNull(); // first sibling
    });

    it('Shift+Tab: one level up; a top-level task stays', () => {
        expect(outdentParent(tasks().find(t => t.id === 'cad')!, tasks())).toBe('t250');
        expect(outdentParent(tasks().find(t => t.id === 'hw')!, tasks())).toBeNull(); // → top level
        expect(outdentParent(tasks().find(t => t.id === 'blog')!, tasks())).toBeUndefined();
    });

    it('Alt+↑/↓ swaps with the neighbour and renumbers the siblings', () => {
        expect(reorderPatches(tasks().find(t => t.id === 'cad')!, tasks(), 1))
            .toEqual([{ id: 'prints', order: 0 }, { id: 'cad', order: 1 }]);
        expect(reorderPatches(tasks().find(t => t.id === 'cad')!, tasks(), -1)).toEqual([]);
    });
});
