import { describe, expect, it } from 'vitest';

import { suggestProjects, suggestTags } from './suggestions.ts';
import { makeTask } from '../testing/treeFixtures.ts';
import type { ProjectOption } from './projects.ts';
import type { Tag } from '../types.ts';

const project = (id: string, depth = 0): ProjectOption => ({ id, header: id, path: id, depth, color: null });
const tag = (id: string): Tag => ({ id, name: id, hex_color: '#000' });

describe('suggestProjects (quick-add sheet chips)', () => {
    const options = ['t250', 'hw', 'blog', 'milk', 'garden'].map(id => project(id));

    it('lists recently used projects first, then the rest in picker order', () => {
        expect(suggestProjects(options, ['blog', 'hw'], 4).map(p => p.id)).toEqual(['blog', 'hw', 't250', 'milk']);
    });

    it('skips recents that are gone (completed or deleted)', () => {
        expect(suggestProjects(options, ['old', 'milk'], 3).map(p => p.id)).toEqual(['milk', 't250', 'hw']);
    });
});

describe('suggestTags', () => {
    const tags = ['maker', 'writing', 'errand', 'meeting'].map(tag);
    const tasks = [
        makeTask('a', { tags: [tags[1]] }),
        makeTask('b', { tags: [tags[1], tags[2]] }),
        makeTask('c', { tags: [tags[2]], is_done: true }), // done tasks don't count
        makeTask('d', { tags: [tags[3]] }),
    ];

    it('lists recent tags first, then by use in open tasks, then by name', () => {
        expect(suggestTags(tags, tasks, ['maker'], 4).map(t => t.id)).toEqual(['maker', 'writing', 'errand', 'meeting']);
        expect(suggestTags(tags, tasks, [], 2).map(t => t.id)).toEqual(['writing', 'errand']);
    });

    it('ignores recent ids of deleted tags', () => {
        expect(suggestTags(tags, tasks, ['gone'], 1).map(t => t.id)).toEqual(['writing']);
    });
});
