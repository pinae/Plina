import { afterEach, describe, expect, it } from 'vitest';

import { makeTask, makerTag, treeTasks } from '../testing/treeFixtures.ts';
import {
    ACTIVE_PROJECT, EMPTY_FILTER, NO_TAG, activeFilterCount, filterTasks, kindSummary, matchesTask, normalizeFilter,
    filtersEqual, readFilter, storeFilter, toggled, withoutKind, type FilterContext, type TaskFilter,
} from './taskFilter.ts';

const context: FilterContext = { activeId: null, defaultMinutes: 60 };
const filter = (over: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_FILTER, ...over });
const passing = (tasks: ReturnType<typeof treeTasks>, f: TaskFilter, ctx = context) =>
    tasks.filter(task => matchesTask(task, f, ctx)).map(task => task.id);

describe('matchesTask', () => {
    it('lets everything through without a filter', () => {
        expect(passing(treeTasks(), EMPTY_FILTER)).toHaveLength(5);
        expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    });

    it('searches all words in the title and description, in any case', () => {
        const tasks = [...treeTasks(), makeTask('notes', { header: 'Notes', description: 'compare CMS prices' })];
        expect(passing(tasks, filter({ search: 'cms' }))).toEqual(['article', 'notes']);
        expect(passing(tasks, filter({ search: 'CMS compar' }))).toEqual(['article', 'notes']);
        expect(passing(tasks, filter({ search: 'cms hardware' }))).toEqual([]);
    });

    it('takes a project with its subtasks; several projects are alternatives', () => {
        expect(passing(treeTasks(), filter({ projects: ['hw'] }))).toEqual(['hw', 'cad']);
        expect(passing(treeTasks(), filter({ projects: ['hw', 'blog'] }))).toEqual(['hw', 'cad', 'blog', 'article']);
    });

    it('follows the active project of the header', () => {
        const f = filter({ projects: [ACTIVE_PROJECT] });
        expect(passing(treeTasks(), f, { ...context, activeId: 'blog' })).toEqual(['blog', 'article']);
        expect(passing(treeTasks(), f, context)).toEqual([]); // no active project: nothing
    });

    it('filters by tags, or for tasks without one', () => {
        expect(passing(treeTasks(), filter({ tags: [makerTag.id] }))).toEqual(['hw', 'cad']);
        expect(passing(treeTasks(), filter({ tags: [NO_TAG] }))).toEqual(['t250', 'blog', 'article']);
        expect(passing(treeTasks(), filter({ tags: [makerTag.id, NO_TAG] }))).toHaveLength(5);
    });

    it('sorts estimates into presets; a task without its own counts as not estimated', () => {
        const tasks = [
            makeTask('quick', { duration: '00:10:00' }), makeTask('hour', { duration: '01:00:00' }),
            makeTask('half-day', { duration: '04:00:00' }), makeTask('long', { duration: '06:00:00' }),
            makeTask('open', { duration: null, is_estimated: false }),
        ];
        expect(passing(tasks, filter({ estimates: ['le15'] }))).toEqual(['quick']);
        expect(passing(tasks, filter({ estimates: ['le60'] }))).toEqual(['quick', 'hour']);
        expect(passing(tasks, filter({ estimates: ['1to4'] }))).toEqual(['half-day']);
        expect(passing(tasks, filter({ estimates: ['gt4', 'none'] }))).toEqual(['long', 'open']);
    });

    it('sorts by time worked: not started, started (also tracking now), over estimate', () => {
        const tasks = [
            makeTask('fresh'), makeTask('running', { active_tracking_start: '2026-10-08T08:00:00Z' }),
            makeTask('begun', { time_spent: '00:30:00' }), makeTask('over', { time_spent: '01:30:00' }),
            makeTask('open', { duration: null, is_estimated: false, time_spent: '01:10:00' }), // default 1h
        ];
        expect(passing(tasks, filter({ worked: ['not_started'] }))).toEqual(['fresh']);
        expect(passing(tasks, filter({ worked: ['started'] }))).toEqual(['running', 'begun', 'over', 'open']);
        expect(passing(tasks, filter({ worked: ['over'] }))).toEqual(['over', 'open']);
    });

    it('filters by a priority range, both ends included', () => {
        expect(passing(treeTasks(), filter({ priority: [7, 10] }))).toEqual(['t250', 'hw', 'cad']);
        expect(passing(treeTasks(), filter({ priority: [5, 6] }))).toEqual(['blog', 'article']);
    });

    it('needs every filter to hold', () => {
        const f = filter({ projects: ['t250'], tags: [makerTag.id], search: 'cad' });
        expect(passing(treeTasks(), f)).toEqual(['cad']);
        expect(activeFilterCount(f)).toBe(3);
    });
});

describe('filterTasks', () => {
    it('keeps the ancestors of matches as context', () => {
        const result = filterTasks(treeTasks(), filter({ search: 'cad' }), context);
        expect([...result.matching]).toEqual(['cad']);
        expect([...result.context].sort()).toEqual(['hw', 't250']);
    });
});

describe('the filter per browser', () => {
    afterEach(() => localStorage.clear());

    it('is remembered and read back', () => {
        const f = filter({ search: 'cad', tags: [makerTag.id], priority: [3, 8] });
        storeFilter(f);
        expect(readFilter()).toEqual(f);
    });

    it('counts a broken entry as no filter and completes partial ones', () => {
        localStorage.setItem('plina.taskFilter', '{oops');
        expect(readFilter()).toEqual(EMPTY_FILTER);
        expect(normalizeFilter({ tags: ['x', 3 as unknown as string], estimates: ['le15', 'soon' as never],
            priority: [12, -2] as [number, number] }))
            .toEqual({ ...EMPTY_FILTER, tags: ['x'], estimates: ['le15'], priority: [0, 10] });
    });
});

describe('the labels', () => {
    const sources = {
        projectName: (id: string) => ({ t250: 'T250', blog: 'Blog' } as Record<string, string>)[id],
        tagName: (id: string) => (id === makerTag.id ? 'maker' : undefined),
    };

    it('summarise each filter kind, or say it is off', () => {
        const f = filter({ projects: ['t250', 'blog'], tags: [makerTag.id], estimates: ['le60'], priority: [7, 10] });
        expect(kindSummary(f, 'projects', sources)).toBe('T250 +1');
        expect(kindSummary(f, 'tags', sources)).toBe('#maker');
        expect(kindSummary(f, 'estimates', sources)).toBe('≤ 1 h');
        expect(kindSummary(f, 'worked', sources)).toBeNull();
        expect(kindSummary(f, 'priority', sources)).toBe('!7–10');
        expect(kindSummary(filter({ priority: [5, 5] }), 'priority', sources)).toBe('!5');
        expect(kindSummary(filter({ projects: [ACTIVE_PROJECT], tags: [NO_TAG] }), 'projects', sources)).toBe('Active project');
        expect(kindSummary(filter({ tags: [NO_TAG] }), 'tags', sources)).toBe('No tag');
    });

    it('still count choices whose project or tag is gone', () => {
        expect(kindSummary(filter({ projects: ['gone'] }), 'projects', sources)).toBe('1 project');
    });

    it('remove one kind and toggle choices', () => {
        expect(withoutKind(filter({ tags: ['x'], search: 'a' }), 'tags')).toEqual(filter({ search: 'a' }));
        expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
        expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    });
});

describe('filtersEqual', () => {
    it('ignores the order of choices and surrounding spaces of the search', () => {
        expect(filtersEqual(filter({ tags: ['a', 'b'], search: 'cad ' }), filter({ tags: ['b', 'a'], search: 'cad' })))
            .toBe(true);
        expect(filtersEqual(filter({ tags: ['a'] }), filter({ tags: ['a', 'b'] }))).toBe(false);
        expect(filtersEqual(filter({ priority: [3, 10] }), EMPTY_FILTER)).toBe(false);
    });
});
