import { describe, expect, it } from 'vitest';

import { makeTask } from '../testing/treeFixtures.ts';
import { TASK_COLOR_PALETTE, inheritedColorFor, titleColor } from './taskColors.ts';

const project = makeTask('p', { hex_color: '#477ed8', inherited_hex_color: '#477ed8', children_ids: ['c'] });
const child = makeTask('c', { parent_id: 'p', ancestor_ids: ['p'], hex_color: '#477ed8', inherited_hex_color: '#477ed8' });
const other = makeTask('o', { hex_color: '#ca5551', inherited_hex_color: '#9f7100', own_hex_color: '#ca5551' });
const tasks = [project, child, other];

describe('inheritedColorFor', () => {
    it('is the color of the parent chosen in the form', () => {
        expect(inheritedColorFor(child, 'p', tasks)).toBe('#477ed8');
        expect(inheritedColorFor(child, 'o', tasks)).toBe('#ca5551'); // moving it there
        expect(inheritedColorFor(undefined, 'o', tasks)).toBe('#ca5551'); // a new subtask
    });

    it("is a project's automatic color, not its chosen one", () => {
        expect(inheritedColorFor(other, null, tasks)).toBe('#9f7100');
    });

    it('is unknown until saved for a new project or a task made top-level', () => {
        expect(inheritedColorFor(undefined, null, tasks)).toBeNull();
        expect(inheritedColorFor(child, null, tasks)).toBeNull();
    });
});

describe('TASK_COLOR_PALETTE', () => {
    it('has ten distinct #rrggbb swatches with names', () => {
        expect(TASK_COLOR_PALETTE).toHaveLength(10);
        expect(new Set(TASK_COLOR_PALETTE.map(c => c.hex)).size).toBe(10);
        for (const { name, hex } of TASK_COLOR_PALETTE) {
            expect(name).toBeTruthy();
            expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        }
    });
});

describe('titleColor', () => {
    it('lightens the task color by a quarter towards white, so titles stay readable on dark rows', () => {
        expect(titleColor('#9f7100')).toBe('#b79540');
        expect(titleColor('#e91e63')).toBe('#ef568a');
        expect(titleColor('#ffffff')).toBe('#ffffff');
    });

    it('is undefined without a color (the theme\'s text color applies)', () => {
        expect(titleColor(null)).toBeUndefined();
    });
});
