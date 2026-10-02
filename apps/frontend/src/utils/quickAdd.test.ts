import { describe, expect, it } from 'vitest';
import { parseQuickAdd, type QuickAddContext } from './quickAdd.ts';

// Monday, 28 Sep 2026, 10:00 local time.
const now = new Date(2026, 8, 28, 10, 0);
const context: QuickAddContext = {
    now,
    tags: [{ id: 'tag-maker', name: 'maker' }, { id: 'tag-deep', name: 'deep-work' }],
    projects: [
        { id: 'p-t250', header: 'T250' },
        { id: 'p-hw', header: 'Hardware Design', path: 'T250 › Hardware Design' },
        { id: 'p-blog', header: 'Company Blog' },
        { id: 'p-a', header: 'Project Alpha' },
        { id: 'p-b', header: 'Project Beta' },
    ],
};
const parse = (text: string) => parseQuickAdd(text, context);
/** Local end of day, as deadlines default to 23:59. */
const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 23, 59);

describe('parseQuickAdd — the example from the spec', () => {
    it('splits header and tokens', () => {
        const text = 'Order high-temp filament 30m #maker !7 >fri';
        const result = parse(text);
        expect(result.header).toBe('Order high-temp filament');
        expect(result.durationMinutes).toBe(30);
        expect(result.tags).toEqual({ existing: ['tag-maker'], new: [] });
        expect(result.priority).toBe(7);
        expect(result.deadline).toEqual(day(2026, 10, 2));
        expect(result.parentId).toBeNull();
        expect(result.errors).toEqual([]);
        expect(result.tokens.map(t => t.kind)).toEqual(['duration', 'tag', 'priority', 'deadline']);
        for (const token of result.tokens) {
            expect(['30m', '#maker', '!7', '>fri']).toContain(text.slice(token.start, token.end));
        }
        expect(result.tokens.map(t => t.label)).toEqual(['30m', '#maker', '!7', 'Fri 02.10.']);
    });
});

describe('durations', () => {
    it.each([
        ['30m', 30], ['90min', 90], ['2h', 120], ['1.5h', 90], ['1,5h', 90], ['.25h', 15], ['1:30', 90],
    ])('%s → %i minutes', (token, minutes) => {
        const result = parse(`Task ${token}`);
        expect(result.durationMinutes).toBe(minutes);
        expect(result.header).toBe('Task');
    });

    it('leaves bare numbers in the header', () => {
        const result = parse('Buy 2 apples');
        expect(result.header).toBe('Buy 2 apples');
        expect(result.durationMinutes).toBeNull();
    });

    it.each([['0m'], ['2000h']])('rejects %s with an error chip', token => {
        const result = parse(`Task ${token}`);
        expect(result.durationMinutes).toBeNull();
        expect(result.tokens[0]).toMatchObject({ kind: 'error', label: token });
        expect(result.errors).toHaveLength(1);
    });

    it('keeps the first of two durations and flags the second', () => {
        const result = parse('Task 30m 1h');
        expect(result.durationMinutes).toBe(30);
        expect(result.tokens.map(t => t.kind)).toEqual(['duration', 'error']);
        expect(result.errors[0]).toMatch(/one duration/i);
    });
});

describe('tags', () => {
    it('matches existing tags case-insensitively', () => {
        expect(parse('Task #Maker').tags).toEqual({ existing: ['tag-maker'], new: [] });
    });

    it('collects unknown tags as new ones', () => {
        const result = parse('Task #garden #maker');
        expect(result.tags).toEqual({ existing: ['tag-maker'], new: ['garden'] });
        expect(result.tokens[0]).toMatchObject({ kind: 'newTag', label: '#garden (new)' });
    });

    it('counts a repeated tag once', () => {
        expect(parse('Task #maker #MAKER').tags.existing).toEqual(['tag-maker']);
    });

    it.each([['#'], ['C#']])('treats %s as text', text => {
        const result = parse(`Learn ${text}`);
        expect(result.header).toBe(`Learn ${text}`);
        expect(result.tokens).toEqual([]);
    });
});

describe('projects', () => {
    it.each([
        ['+T250', 'p-t250'],
        ['+company-blog', 'p-blog'],
        ['+CompanyBlog', 'p-blog'],
        ['+Blog', 'p-blog'],          // a word of the name
        ['+hard', 'p-hw'],            // unique prefix
    ])('%s → %s', (token, id) => {
        const result = parse(`Task ${token}`);
        expect(result.parentId).toBe(id);
        expect(result.errors).toEqual([]);
    });

    it('labels sub-projects with their path', () => {
        expect(parse('Task +hard').tokens[0].label).toBe('T250 › Hardware Design');
    });

    it('flags an ambiguous project and names the candidates', () => {
        const result = parse('Task +Proj');
        expect(result.parentId).toBeNull();
        expect(result.tokens[0].kind).toBe('error');
        expect(result.errors[0]).toContain('Project Alpha');
        expect(result.errors[0]).toContain('Project Beta');
    });

    it('flags an unknown project', () => {
        const result = parse('Task +Nope');
        expect(result.tokens[0].kind).toBe('error');
        expect(result.errors[0]).toMatch(/no project/i);
    });
});

describe('priority', () => {
    it.each([['!0', 0], ['!7', 7], ['!10', 10], ['!7.5', 7.5], ['!7,5', 7.5]])('%s → %d', (token, value) => {
        expect(parse(`Task ${token}`).priority).toBe(value);
    });

    it.each([['!11'], ['!x'], ['!-1']])('rejects %s', token => {
        const result = parse(`Task ${token}`);
        expect(result.priority).toBeNull();
        expect(result.tokens[0].kind).toBe('error');
        expect(result.errors[0]).toMatch(/0 and 10/);
    });

    it('treats a lone ! as text', () => {
        expect(parse('Wow !').header).toBe('Wow !');
    });
});

describe('deadlines', () => {
    it.each([
        ['>today', day(2026, 9, 28)], ['>heute', day(2026, 9, 28)],
        ['>tomorrow', day(2026, 9, 29)], ['>morgen', day(2026, 9, 29)],
        ['>übermorgen', day(2026, 9, 30)],
        ['>tue', day(2026, 9, 29)], ['>tuesday', day(2026, 9, 29)],
        ['>di', day(2026, 9, 29)], ['>dienstag', day(2026, 9, 29)],
        ['>fri', day(2026, 10, 2)], ['>fr', day(2026, 10, 2)], ['>freitag', day(2026, 10, 2)],
        ['>so', day(2026, 10, 4)], ['>sun', day(2026, 10, 4)],
        ['>mon', day(2026, 10, 5)],       // today's weekday means next week
        ['>montag', day(2026, 10, 5)],
        ['>2026-10-03', day(2026, 10, 3)],
        ['>3.10.', day(2026, 10, 3)],
        ['>3.10.2026', day(2026, 10, 3)],
        ['>28.9.', day(2026, 9, 28)],     // today is fine
        ['>1.3.', day(2027, 3, 1)],       // already passed this year → next year
    ])('%s', (token, expected) => {
        const result = parse(`Task ${token}`);
        expect(result.errors).toEqual([]);
        expect(result.deadline).toEqual(expected);
    });

    it.each([['>32.1.'], ['>30.2.'], ['>2026-13-01'], ['>someday']])('%s is an error chip, not text', token => {
        const result = parse(`Task ${token}`);
        expect(result.deadline).toBeNull();
        expect(result.header).toBe('Task');
        expect(result.tokens[0]).toMatchObject({ kind: 'error', label: token });
        expect(result.errors[0]).toMatch(/not a valid date/);
    });

    it('rejects a date in the past', () => {
        const result = parse('Task >2025-01-01');
        expect(result.deadline).toBeNull();
        expect(result.errors[0]).toMatch(/in the past/);
    });

    it('treats a lone > as text', () => {
        expect(parse('a > b').header).toBe('a > b');
    });
});

describe('escaping and header text', () => {
    it.each([
        ['Issue \\#1', 'Issue #1'],
        ['Read \\30m article', 'Read 30m article'],
        ['Say \\!7', 'Say !7'],
        ['Arrow \\>fri', 'Arrow >fri'],
        ['Plus \\+Blog', 'Plus +Blog'],
    ])('%s → header %s', (text, header) => {
        const result = parse(text);
        expect(result.header).toBe(header);
        expect(result.tokens).toEqual([]);
    });

    it('collapses whitespace around removed tokens', () => {
        expect(parse('  Write   #maker   article  ').header).toBe('Write article');
    });

    it('returns an empty header when only tokens were typed', () => {
        expect(parse('30m #maker').header).toBe('');
    });
});
