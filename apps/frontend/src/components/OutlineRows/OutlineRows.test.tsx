import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { OutlineRows } from './OutlineRows.tsx';
import { newRow, type OutlineRow } from '../../utils/outline.ts';
import { computeBudgets } from '../../utils/splitMath.ts';

const context = { now: new Date(2026, 8, 28, 10), tags: [{ id: 'tag-maker', name: 'maker' }], projects: [] };
let latest: OutlineRow[] = [];

function Harness({ initial }: { initial: OutlineRow[] }) {
    const [rows, setRows] = useState(initial);
    const change = (next: OutlineRow[]) => {
        latest = next;
        setRows(next);
    };
    return <OutlineRows rows={rows} budgets={computeBudgets(rows, 720, 60)} onChange={change} context={context} />;
}

const row = (header: string, depth = 0, minutes: number | null = null): OutlineRow =>
    ({ ...newRow(depth), header, minutes });
const headers = () => screen.getAllByRole('textbox', { name: /^part \d+$/i });
const shape = () => latest.map(r => `${'-'.repeat(r.depth)}${r.header}`);

describe('OutlineRows', () => {
    afterEach(() => {
        cleanup();
        latest = [];
    });

    it('shows ghost shares as placeholders and explicit estimates as values', () => {
        render(<Harness initial={[row('CAD', 0, 180), row('prints'), row('orders')]} />);
        const estimates = screen.getAllByRole('textbox', { name: /^estimate of part/i });
        expect(estimates[0]).toHaveValue('3h');
        expect(estimates[1]).toHaveAttribute('placeholder', '~4h 30m');
        expect(estimates[2]).toHaveAttribute('placeholder', '~4h 30m');
    });

    it('Enter adds a row below and focuses it', () => {
        render(<Harness initial={[row('CAD')]} />);
        fireEvent.keyDown(headers()[0], { key: 'Enter' });
        expect(headers()).toHaveLength(2);
        expect(headers()[1]).toHaveFocus();
    });

    it('Tab indents, Shift+Tab outdents', () => {
        render(<Harness initial={[row('CAD'), row('housing')]} />);
        fireEvent.keyDown(headers()[1], { key: 'Tab' });
        expect(shape()).toEqual(['CAD', '-housing']);
        fireEvent.keyDown(headers()[1], { key: 'Tab', shiftKey: true });
        expect(shape()).toEqual(['CAD', 'housing']);
    });

    it('Backspace in an empty row removes it and focuses the row above', () => {
        render(<Harness initial={[row('CAD'), row('')]} />);
        fireEvent.keyDown(headers()[1], { key: 'Backspace' });
        expect(shape()).toEqual(['CAD']);
        expect(headers()[0]).toHaveFocus();
    });

    it('Alt+↓ moves a row down', () => {
        render(<Harness initial={[row('a'), row('b')]} />);
        fireEvent.keyDown(headers()[0], { key: 'ArrowDown', altKey: true });
        expect(shape()).toEqual(['b', 'a']);
    });

    it('↑/↓ move the focus between rows', () => {
        render(<Harness initial={[row('a'), row('b')]} />);
        fireEvent.keyDown(headers()[0], { key: 'ArrowDown' });
        expect(headers()[1]).toHaveFocus();
    });

    it('typing "CAD 3h #maker" moves the tokens out of the header', () => {
        render(<Harness initial={[row('')]} />);
        fireEvent.change(headers()[0], { target: { value: 'CAD 3h #maker' } });
        fireEvent.keyDown(headers()[0], { key: 'Enter' });
        expect(latest[0]).toMatchObject({ header: 'CAD', minutes: 180, tagIds: ['tag-maker'] });
        expect(screen.getByText('#maker')).toBeInTheDocument();
    });

    it('typing an estimate makes the row explicit; clearing makes it a ghost again', () => {
        render(<Harness initial={[row('CAD')]} />);
        const estimate = screen.getByRole('textbox', { name: /^estimate of part 1/i });
        fireEvent.change(estimate, { target: { value: '1,5' } });
        expect(latest[0].minutes).toBe(90);
        fireEvent.change(estimate, { target: { value: '' } });
        expect(latest[0].minutes).toBeNull();
    });

    it('flags an estimate it cannot read', () => {
        render(<Harness initial={[row('CAD')]} />);
        fireEvent.change(screen.getByRole('textbox', { name: /^estimate of part 1/i }), { target: { value: 'soon' } });
        expect(screen.getByText(/“soon” is not a duration/)).toBeInTheDocument();
        expect(latest[0].minutes).toBeNull();
    });

    it('pasting an indented list creates nested rows', () => {
        render(<Harness initial={[row('')]} />);
        fireEvent.paste(headers()[0], {
            clipboardData: { getData: () => 'Hardware\n  CAD 3h\n  test prints\nFirmware' },
        });
        expect(shape()).toEqual(['Hardware', '-CAD', '-test prints', 'Firmware']);
        expect(latest[1].minutes).toBe(180);
    });

    it('shows completed parts read-only', () => {
        render(<Harness initial={[{ ...row('Done part', 0, 60), done: true }]} />);
        expect(headers()[0]).toBeDisabled();
    });
});
