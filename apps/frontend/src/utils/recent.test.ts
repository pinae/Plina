import { afterEach, describe, expect, it } from 'vitest';

import { readRecent, rememberRecent } from './recent.ts';

afterEach(() => localStorage.clear());

describe('recently used ids (per browser)', () => {
    it('keeps the latest first, without duplicates, capped', () => {
        for (const id of ['a', 'b', 'c', 'a']) rememberRecent('test', id, 3);
        expect(readRecent('test')).toEqual(['a', 'c', 'b']);
        rememberRecent('test', 'd', 3);
        expect(readRecent('test')).toEqual(['d', 'a', 'c']);
    });

    it('survives garbage in the storage', () => {
        localStorage.setItem('test', '{"no": "list"}');
        expect(readRecent('test')).toEqual([]);
        localStorage.setItem('test', 'not json');
        expect(readRecent('test')).toEqual([]);
        localStorage.setItem('test', '["ok", 3, null]');
        expect(readRecent('test')).toEqual(['ok']);
    });
});
