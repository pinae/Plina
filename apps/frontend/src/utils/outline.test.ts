import { describe, expect, it } from 'vitest';
import {
    commitRowTokens, indent, insertAfter, move, newRow, outdent, removeAt, rowsFromText, toTree, type OutlineRow,
} from './outline.ts';

const row = (header: string, depth = 0, extra: Partial<OutlineRow> = {}): OutlineRow =>
    ({ ...newRow(depth), key: header, header, ...extra });
const shape = (rows: OutlineRow[]) => rows.map(r => `${'-'.repeat(r.depth)}${r.header}`);

// A
// -A1
// -A2
// B
const sample = () => [row('A'), row('A1', 1), row('A2', 1), row('B')];

describe('outline operations', () => {
    it('inserts a sibling after the row and its subtree', () => {
        const { rows, index } = insertAfter(sample(), 0);
        expect(shape(rows)).toEqual(['A', '-A1', '-A2', '', 'B']);
        expect(index).toBe(3);
    });

    it('indents a row under the row above, taking its subtree along', () => {
        const rows = indent([row('A'), row('B'), row('B1', 1)], 1);
        expect(shape(rows)).toEqual(['A', '-B', '--B1']);
    });

    it('does not indent deeper than one level below the row above', () => {
        expect(shape(indent(sample(), 0))).toEqual(shape(sample()));
        expect(shape(indent([row('A'), row('A1', 1)], 1))).toEqual(['A', '-A1']);
    });

    it('outdents a row with its subtree', () => {
        const rows = outdent([row('A'), row('A1', 1), row('A1a', 2)], 1);
        expect(shape(rows)).toEqual(['A', 'A1', '-A1a']);
        expect(shape(outdent(sample(), 0))).toEqual(shape(sample()));
    });

    it('moves a row with its subtree past its sibling', () => {
        const down = move(sample(), 0, 1);
        expect(shape(down.rows)).toEqual(['B', 'A', '-A1', '-A2']);
        expect(down.index).toBe(1);
        const up = move(sample(), 2, -1);
        expect(shape(up.rows)).toEqual(['A', '-A2', '-A1', 'B']);
        expect(move(sample(), 0, -1).rows).toEqual(sample()); // first sibling stays
    });

    it('removes an empty row but never one with subtasks', () => {
        expect(shape(removeAt(sample(), 3))).toEqual(['A', '-A1', '-A2']);
        expect(removeAt(sample(), 0)).toEqual(sample());
    });

    it('builds the nested tree', () => {
        const tree = toTree(sample());
        expect(tree.map(n => [n.row.header, n.children.map(c => c.row.header)])).toEqual([
            ['A', ['A1', 'A2']], ['B', []],
        ]);
    });
});

describe('rowsFromText (paste)', () => {
    it('turns an indented list into nested rows', () => {
        const text = 'Brainstorming\nHardware Design\n  CAD 3h\n  - test prints\n\t- component orders\nFirmware';
        const rows = rowsFromText(text, 0);
        expect(shape(rows)).toEqual([
            'Brainstorming', 'Hardware Design', '-CAD 3h', '-test prints', '-component orders', 'Firmware',
        ]);
    });

    it('strips bullets and numbers and ignores empty lines', () => {
        expect(shape(rowsFromText('* one\n\n2. two\n• three', 1))).toEqual(['-one', '-two', '-three']);
    });

    it('never jumps more than one level deeper', () => {
        expect(shape(rowsFromText('a\n        b', 0))).toEqual(['a', '-b']);
    });
});

describe('commitRowTokens', () => {
    const context = { now: new Date(2026, 8, 28, 10), tags: [{ id: 'tag-maker', name: 'maker' }], projects: [] };

    it('moves tokens out of the header into the row', () => {
        const committed = commitRowTokens(row('CAD 3h #maker #garden !8 >fri'), context);
        expect(committed).toMatchObject({
            header: 'CAD', minutes: 180, durationText: '3h', tagIds: ['tag-maker'], newTags: ['garden'],
            priority: 8, error: undefined,
        });
        expect(new Date(committed.deadline!).getDate()).toBe(2); // Fri 2 Oct
    });

    it('keeps the text and reports unknown tokens', () => {
        const committed = commitRowTokens(row('CAD >32.1.'), context);
        expect(committed.header).toBe('CAD >32.1.');
        expect(committed.error).toMatch(/not a valid date/);
    });

    it('refuses to move a part to another project from here', () => {
        expect(commitRowTokens(row('CAD +Blog'), context).error).toMatch(/task dialog/);
    });

    it('leaves plain text alone', () => {
        const plain = row('Assembly');
        expect(commitRowTokens(plain, context)).toBe(plain);
    });
});
