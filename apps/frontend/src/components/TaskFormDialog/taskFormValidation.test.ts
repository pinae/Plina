import { describe, it, expect } from 'vitest';
import {
    formatHoursInput, parseDurationInput, validateTaskForm,
    type TaskFormValues, type ValidationContext,
} from './taskFormValidation.ts';

const NOW = new Date('2026-07-08T12:00:00');

const valid: TaskFormValues = {
    header: 'Write report', description: '', hours: '1.5',
    deadline: '', deadlineIncomplete: false,
    priority: 5, tagIds: [], projectId: '',
    isAppointment: false, start: '', startIncomplete: false,
};
const ctx: ValidationContext = { now: NOW, knownTagIds: ['t1'], knownProjectIds: ['p1'] };

const errorsFor = (over: Partial<TaskFormValues>, context: Partial<ValidationContext> = {}) =>
    validateTaskForm({ ...valid, ...over }, { ...ctx, ...context });

describe('parseDurationInput', () => {
    it.each([
        ['1.5', 90], ['1,5', 90], ['.25', 15], ['2', 120], ['2h', 120], ['1.5 h', 90],
        ['1:30', 90], ['0:45', 45], ['90m', 90], ['90 min', 90],
    ])('parses %s as %i minutes', (text, minutes) => {
        expect(parseDurationInput(text)).toEqual({ kind: 'ok', minutes });
    });

    it('reports empty input separately from malformatted input', () => {
        expect(parseDurationInput('   ')).toEqual({ kind: 'empty' });
        expect(parseDurationInput('abc')).toEqual({ kind: 'invalid' });
        expect(parseDurationInput('1.5.2')).toEqual({ kind: 'invalid' });
        expect(parseDurationInput('1:75')).toEqual({ kind: 'invalid' }); // minutes > 59
    });

    it('keeps the sign so negative input gets its own message', () => {
        expect(parseDurationInput('-2')).toEqual({ kind: 'ok', minutes: -120 });
    });
});

describe('formatHoursInput', () => {
    it('prefers whole or short decimal hours and falls back to h:mm', () => {
        expect(formatHoursInput(120)).toBe('2');
        expect(formatHoursInput(90)).toBe('1.5');
        expect(formatHoursInput(15)).toBe('0.25');
        expect(formatHoursInput(80)).toBe('1:20');
    });
});

describe('validateTaskForm', () => {
    it('accepts a complete, valid form — including an empty description', () => {
        expect(errorsFor({})).toEqual({});
    });

    describe('header', () => {
        it('explains an empty header', () => {
            expect(errorsFor({ header: '  ' }).header).toMatch(/header is empty/i);
        });
        it('explains an over-long header differently', () => {
            const message = errorsFor({ header: 'x'.repeat(1025) }).header!;
            expect(message).toMatch(/too long/i);
            expect(message).toMatch(/1025/);
            expect(message).not.toMatch(/empty/i);
        });
    });

    describe('duration', () => {
        it('distinguishes empty, malformatted, negative, zero and too large', () => {
            const empty = errorsFor({ hours: '' }).hours!;
            const malformed = errorsFor({ hours: 'abc' }).hours!;
            const negative = errorsFor({ hours: '-1' }).hours!;
            const zero = errorsFor({ hours: '0' }).hours!;
            const huge = errorsFor({ hours: '5000' }).hours!;

            expect(empty).toMatch(/duration is empty/i);
            expect(malformed).toMatch(/“abc” is not a valid duration/);
            expect(negative).toMatch(/can't be negative/i);
            expect(zero).toMatch(/at least 1 minute/i);
            expect(huge).toMatch(/more than 1000 hours/i);
            // Every kind reads differently.
            expect(new Set([empty, malformed, negative, zero, huge]).size).toBe(5);
        });
        it('treats a duration that rounds below one minute as zero', () => {
            expect(errorsFor({ hours: '0.001' }).hours).toMatch(/at least 1 minute/i);
        });
    });

    describe('deadline', () => {
        it('is optional', () => {
            expect(errorsFor({ deadline: '' }).deadline).toBeUndefined();
        });
        it('explains an incompletely typed date', () => {
            expect(errorsFor({ deadline: '', deadlineIncomplete: true }).deadline)
                .toMatch(/deadline is incomplete/i);
        });
        it('explains a malformatted value differently', () => {
            expect(errorsFor({ deadline: 'yesterday-ish' }).deadline)
                .toMatch(/not a valid date and time/i);
        });
        it('rejects a new deadline in the past', () => {
            expect(errorsFor({ deadline: '2026-07-01T09:00' }).deadline).toMatch(/in the past/i);
        });
        it('keeps an unchanged past deadline editable', () => {
            expect(errorsFor(
                { deadline: '2026-07-01T09:00' }, { originalDeadline: '2026-07-01T09:00' },
            ).deadline).toBeUndefined();
        });
        it('rejects a deadline before the appointment ends', () => {
            expect(errorsFor({
                isAppointment: true, start: '2026-07-10T10:00', hours: '2',
                deadline: '2026-07-10T11:00', // appointment runs until 12:00
            }).deadline).toMatch(/before the appointment ends/i);
        });
    });

    describe('appointment start', () => {
        it('is only required for appointments', () => {
            expect(errorsFor({ isAppointment: false, start: '' }).start).toBeUndefined();
            expect(errorsFor({ isAppointment: true, start: '' }).start).toMatch(/needs a start time/i);
        });
        it('explains incomplete and malformatted start times differently', () => {
            const incomplete = errorsFor({ isAppointment: true, start: '', startIncomplete: true }).start!;
            const malformed = errorsFor({ isAppointment: true, start: 'soon' }).start!;
            expect(incomplete).toMatch(/start time is incomplete/i);
            expect(malformed).toMatch(/not a valid date and time/i);
        });
    });

    describe('priority, tags and project', () => {
        it('rejects a priority outside 0–10', () => {
            expect(errorsFor({ priority: 11 }).priority).toMatch(/between 0 and 10/i);
        });
        it('flags a selected tag that no longer exists', () => {
            expect(errorsFor({ tagIds: ['t1', 'gone'] }).tags).toMatch(/no longer exists/i);
        });
        it('flags a selected project that no longer exists', () => {
            expect(errorsFor({ projectId: 'gone' }).project).toMatch(/no longer exists/i);
        });
        it('skips reference checks until tags/projects are loaded', () => {
            const errors = errorsFor(
                { tagIds: ['x'], projectId: 'y' }, { knownTagIds: null, knownProjectIds: null },
            );
            expect(errors.tags).toBeUndefined();
            expect(errors.project).toBeUndefined();
        });
    });
});
