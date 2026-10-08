/**
 * The filter of the Tasks tab and the dependency editor (README: Filtering
 * tasks): a search and filters by project, tag, estimate, time worked and
 * priority. Different filters must all hold (AND); the choices within one
 * are alternatives (OR): #maker or #writing. All in the browser — every task
 * is loaded anyway.
 */
import type { Task } from '../types.ts';
import { parseDurationMinutes } from './duration.ts';

export type EstimatePreset = 'le15' | 'le60' | '1to4' | 'gt4' | 'none';
export type WorkedPreset = 'not_started' | 'started' | 'over';

/** The active project of the header switcher, as a project choice. */
export const ACTIVE_PROJECT = 'active';
/** Tasks without tags, as a tag choice. */
export const NO_TAG = 'none';

export interface TaskFilter {
    /** Words in the title or description (all of them). */
    search: string;
    /** Projects and sub-projects (with their subtasks), or ``ACTIVE_PROJECT``. */
    projects: string[];
    /** Tag ids, or ``NO_TAG``. */
    tags: string[];
    estimates: EstimatePreset[];
    worked: WorkedPreset[];
    /** From–to, both included. */
    priority: [number, number];
}

export const PRIORITY_RANGE: [number, number] = [0, 10];

export const EMPTY_FILTER: TaskFilter = {
    search: '', projects: [], tags: [], estimates: [], worked: [], priority: PRIORITY_RANGE,
};

export const ESTIMATE_LABELS: Record<EstimatePreset, string> = {
    le15: '≤ 15 min', le60: '≤ 1 h', '1to4': '1–4 h', gt4: '> 4 h', none: 'Not estimated',
};

export const WORKED_LABELS: Record<WorkedPreset, string> = {
    not_started: 'Not started', started: 'Started', over: 'Over estimate',
};

const priorityNarrowed = (filter: TaskFilter) =>
    filter.priority[0] !== PRIORITY_RANGE[0] || filter.priority[1] !== PRIORITY_RANGE[1];

/** How many filters are on (the search counts as one). */
export function activeFilterCount(filter: TaskFilter): number {
    return [filter.search.trim() !== '', filter.projects.length > 0, filter.tags.length > 0,
        filter.estimates.length > 0, filter.worked.length > 0, priorityNarrowed(filter)].filter(Boolean).length;
}

export const isFiltering = (filter: TaskFilter) => activeFilterCount(filter) > 0;

export interface FilterContext {
    /** The active project of the header switcher. */
    activeId: string | null;
    /** The user's default duration (minutes): what an unestimated task counts as. */
    defaultMinutes: number;
}

function estimateOf(task: Task): number | null {
    if (task.is_estimated === false || task.duration === null) return null;
    return parseDurationMinutes(task.duration);
}

function matchesEstimate(task: Task, presets: EstimatePreset[]): boolean {
    const minutes = estimateOf(task);
    return presets.some(preset => {
        if (preset === 'none') return minutes === null;
        if (minutes === null) return false;
        switch (preset) {
            case 'le15': return minutes <= 15;
            case 'le60': return minutes <= 60;
            case '1to4': return minutes > 60 && minutes <= 240;
            case 'gt4': return minutes > 240;
        }
        return false;
    });
}

function matchesWorked(task: Task, presets: WorkedPreset[], defaultMinutes: number): boolean {
    const spent = parseDurationMinutes(task.time_spent) ?? 0;
    const started = spent > 0 || task.active_tracking_start !== null;
    const estimate = estimateOf(task) ?? defaultMinutes;
    return presets.some(preset => (preset === 'not_started' ? !started
        : preset === 'started' ? started
            : spent > estimate));
}

/** Does ``task`` itself pass ``filter``? */
export function matchesTask(task: Task, filter: TaskFilter, context: FilterContext): boolean {
    const words = filter.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
        const text = `${task.header} ${task.description}`.toLowerCase();
        if (!words.every(word => text.includes(word))) return false;
    }
    if (filter.projects.length) {
        const chosen = filter.projects.map(id => (id === ACTIVE_PROJECT ? context.activeId : id))
            .filter((id): id is string => Boolean(id));
        const lineage = [task.id, ...(task.ancestor_ids ?? [])];
        if (!chosen.some(id => lineage.includes(id))) return false;
    }
    if (filter.tags.length) {
        const ids = task.tags.map(tag => tag.id);
        if (!filter.tags.some(id => (id === NO_TAG ? ids.length === 0 : ids.includes(id)))) return false;
    }
    if (filter.estimates.length && !matchesEstimate(task, filter.estimates)) return false;
    if (filter.worked.length && !matchesWorked(task, filter.worked, context.defaultMinutes)) return false;
    if (priorityNarrowed(filter) && (task.priority < filter.priority[0] || task.priority > filter.priority[1])) {
        return false;
    }
    return true;
}

export interface FilterResult {
    /** The tasks that pass. */
    matching: Set<string>;
    /** Their ancestors that do not pass themselves: shown greyed, to keep the tree. */
    context: Set<string>;
}

export function filterTasks(tasks: Task[], filter: TaskFilter, context: FilterContext): FilterResult {
    const matching = new Set(tasks.filter(task => matchesTask(task, filter, context)).map(task => task.id));
    const contextIds = new Set<string>();
    for (const task of tasks) {
        if (!matching.has(task.id)) continue;
        for (const id of task.ancestor_ids ?? []) if (!matching.has(id)) contextIds.add(id);
    }
    return { matching, context: contextIds };
}

// ------------------------------------------------------------ per browser

const FILTER_KEY = 'plina.taskFilter';

/** The filter as last used in this browser (shared by the Tasks tab and
 *  the dependency editor); a broken entry counts as none. */
export function readFilter(): TaskFilter {
    try {
        const stored = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null');
        if (!stored || typeof stored !== 'object') return EMPTY_FILTER;
        return normalizeFilter(stored);
    } catch {
        return EMPTY_FILTER;
    }
}

export function storeFilter(filter: TaskFilter) {
    try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
    } catch {
        // Storage unavailable: a convenience only.
    }
}

/** Any stored or saved filter, made complete (missing parts: no filter). */
export function normalizeFilter(value: Partial<TaskFilter>): TaskFilter {
    const list = (items: unknown) => (Array.isArray(items) ? items.filter(item => typeof item === 'string') : []);
    const range = Array.isArray(value.priority) && value.priority.length === 2
        && value.priority.every(n => typeof n === 'number')
        ? [Math.max(0, Math.min(...value.priority)), Math.min(10, Math.max(...value.priority))] as [number, number]
        : PRIORITY_RANGE;
    return {
        search: typeof value.search === 'string' ? value.search : '',
        projects: list(value.projects),
        tags: list(value.tags),
        estimates: list(value.estimates).filter((p): p is EstimatePreset => p in ESTIMATE_LABELS),
        worked: list(value.worked).filter((p): p is WorkedPreset => p in WORKED_LABELS),
        priority: range,
    };
}

// ---------------------------------------------------------------- labels

/** The filter kinds, in the order the bar shows them. */
export type FilterKind = 'projects' | 'tags' | 'estimates' | 'worked' | 'priority';

export const FILTER_KIND_LABELS: Record<FilterKind, string> = {
    projects: 'Project', tags: 'Tag', estimates: 'Estimate', worked: 'Time worked', priority: 'Priority',
};

export interface LabelSources {
    /** Project names by id (ids not found are left out: a deleted project). */
    projectName: (id: string) => string | undefined;
    tagName: (id: string) => string | undefined;
}

/** A short summary of one filter kind ("T250 +1", "#maker", "!7–10"), or
 *  null when it is off. */
export function kindSummary(filter: TaskFilter, kind: FilterKind, sources: LabelSources): string | null {
    const several = (names: string[]) =>
        (names.length === 0 ? null : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`);
    const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
    switch (kind) {
        case 'projects':
            return several(filter.projects.map(id => (id === ACTIVE_PROJECT ? 'Active project' : sources.projectName(id)))
                .filter((name): name is string => Boolean(name)))
                ?? (filter.projects.length ? count(filter.projects.length, 'project') : null);
        case 'tags':
            return several(filter.tags.map(id => (id === NO_TAG ? 'No tag' : sources.tagName(id)))
                .filter((name): name is string => Boolean(name)).map(name => (name === 'No tag' ? name : `#${name}`)))
                ?? (filter.tags.length ? count(filter.tags.length, 'tag') : null);
        case 'estimates':
            return several(filter.estimates.map(preset => ESTIMATE_LABELS[preset]));
        case 'worked':
            return several(filter.worked.map(preset => WORKED_LABELS[preset]));
        case 'priority':
            if (!priorityNarrowed(filter)) return null;
            return filter.priority[0] === filter.priority[1] ? `!${filter.priority[0]}` : `!${filter.priority[0]}–${filter.priority[1]}`;
    }
}

/** ``filter`` without ``kind``. */
export function withoutKind(filter: TaskFilter, kind: FilterKind): TaskFilter {
    return { ...filter, [kind]: EMPTY_FILTER[kind] };
}

/** ``list`` with ``item`` added or removed. */
export const toggled = <T,>(list: T[], item: T): T[] =>
    (list.includes(item) ? list.filter(other => other !== item) : [...list, item]);
