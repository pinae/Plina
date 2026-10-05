import { describe, expect, it } from 'vitest';

import { dependencyCreated, dependencyRefusal } from './dependencyMessages.ts';

const headers: Record<string, string> = { fw: 'Firmware', cad: 'CAD', hw: 'Hardware Design', pcb: 'PCB layout' };
const headerOf = (id: string) => headers[id];
const fw = { id: 'fw', header: 'Firmware' };
const cad = { id: 'cad', header: 'CAD' };

describe('dependencyCreated', () => {
    it('reads in the drawing direction: the start task depends on the end task', () => {
        expect(dependencyCreated(fw, cad)).toBe('“Firmware” now depends on “CAD”');
    });
});

describe('dependencyRefusal', () => {
    it('explains a cycle with the chain that already exists', () => {
        // The server reports [successor, …, predecessor, successor]: CAD waits
        // for PCB layout, which waits for Firmware.  (DRF sends every message
        // as a list.)
        const payload = { detail: ['This dependency would create a cycle.'], cycle: ['fw', 'pcb', 'cad', 'fw'] };
        expect(dependencyRefusal(payload, fw, cad, headerOf)).toBe(
            '“Firmware” can’t depend on “CAD” — “CAD” already depends on “Firmware” '
            + '(Firmware → PCB layout → CAD), so this would be a cycle.',
        );
    });

    it('names the pair in front of the server’s reason', () => {
        expect(dependencyRefusal({ detail: ['This dependency already exists.'] }, fw, cad, headerOf))
            .toBe('“Firmware” can’t depend on “CAD” — this dependency already exists.');
        expect(dependencyRefusal({ detail: 'This dependency already exists.' }, fw, cad, headerOf))
            .toBe('“Firmware” can’t depend on “CAD” — this dependency already exists.');
        expect(dependencyRefusal({
            detail: ['“CAD” is part of “Hardware Design”. A task cannot depend on its own parent or subtask.'],
        }, cad, { id: 'hw', header: 'Hardware Design' }, headerOf)).toBe(
            '“CAD” can’t depend on “Hardware Design” — “CAD” is part of “Hardware Design”. '
            + 'A task cannot depend on its own parent or subtask.',
        );
    });

    it('falls back to the server’s cycle message for unknown tasks, and to a retry hint without one', () => {
        expect(dependencyRefusal({ detail: ['This dependency would create a cycle.'], cycle: ['fw', 'gone', 'fw'] },
            fw, cad, headerOf)).toBe('“Firmware” can’t depend on “CAD” — this dependency would create a cycle.');
        expect(dependencyRefusal(undefined, fw, cad, headerOf))
            .toBe('“Firmware” can’t depend on “CAD” right now — the dependency could not be saved. Please try again.');
    });
});
