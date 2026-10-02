/**
 * UI-4: the quick-add parser (docs/task-entry-ui.md §3.3).
 *
 * Turns one line like `Order filament 30m #maker !7 >fri` into a task draft.
 * Pure and synchronous so the header can re-parse on every keystroke and show
 * each recognized token as a chip. Anything that *looks* like a token but
 * cannot be understood (e.g. `>32.1.`, `!11`, an ambiguous `+Pro`) becomes an
 * error chip with a message instead of silently landing in the header.
 *
 * | token      | meaning                        | examples                         |
 * |------------|--------------------------------|----------------------------------|
 * | duration   | estimate (unit or h:mm needed) | `30m` `90min` `1.5h` `1,5h` `1:30` |
 * | `#name`    | tag (unknown → new tag)        | `#maker`                         |
 * | `+name`    | parent project                 | `+Blog` `+company-blog`          |
 * | `!n`       | priority 0–10                  | `!8` `!7.5`                      |
 * | `>date`    | deadline (23:59 local)         | `>fri` `>morgen` `>3.10.` `>2026-10-03` |
 * | `\`        | escapes the next word          | `\#1`                            |
 */
import { parseDurationInput } from '../components/TaskFormDialog/taskFormValidation.ts';
import { formatDuration, minutesToDurationString } from './duration.ts';

export interface QuickAddContext {
    now: Date;
    tags: { id: string; name: string }[];
    /** Projects and sub-projects; ``path`` (breadcrumb) labels the chip. */
    projects: { id: string; header: string; path?: string }[];
}

export type QuickAddTokenKind = 'duration' | 'tag' | 'newTag' | 'project' | 'priority' | 'deadline' | 'error';

export interface QuickAddToken {
    kind: QuickAddTokenKind;
    /** Character range of the word in the input (for highlighting). */
    start: number;
    end: number;
    /** Chip text. */
    label: string;
    /** Error chips only: what is wrong and how to fix it. */
    message?: string;
}

export interface QuickAddResult {
    header: string;
    /** Null = no duration typed: the task is planned with the default. */
    durationMinutes: number | null;
    tags: { existing: string[]; new: string[] };
    /** Null = no `+project` typed: the caller uses the active project. */
    parentId: string | null;
    priority: number | null;
    deadline: Date | null;
    tokens: QuickAddToken[];
    errors: string[];
}

const MAX_DURATION_MINUTES = 1000 * 60;
const DURATION_RE = /^(?:(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:h|m|min)|\d{1,3}:[0-5]\d)$/i;
const PRIORITY_RE = /^-?\d+(?:[.,]\d+)?$/;

// Weekday words → JS day index (0 = Sunday). English and German.
const WEEKDAYS: Record<string, number> = {
    sun: 0, sunday: 0, su: 0, so: 0, sonntag: 0,
    mon: 1, monday: 1, mo: 1, montag: 1,
    tue: 2, tues: 2, tuesday: 2, tu: 2, di: 2, dienstag: 2,
    wed: 3, wednesday: 3, we: 3, mi: 3, mittwoch: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, th: 4, do: 4, donnerstag: 4,
    fri: 5, friday: 5, fr: 5, freitag: 5,
    sat: 6, saturday: 6, sa: 6, samstag: 6,
};
const RELATIVE_DAYS: Record<string, number> = {
    today: 0, heute: 0, tomorrow: 1, morgen: 1, 'übermorgen': 2, uebermorgen: 2,
};
const SHORT_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const endOfDay = (year: number, monthIndex: number, date: number) =>
    new Date(year, monthIndex, date, 23, 59, 0, 0);

/** A real calendar date? (rejects 32.1., 30.2., month 13 …) */
function validDate(year: number, monthIndex: number, date: number): Date | null {
    const candidate = endOfDay(year, monthIndex, date);
    return candidate.getFullYear() === year && candidate.getMonth() === monthIndex
        && candidate.getDate() === date ? candidate : null;
}

type DateParse = { kind: 'ok'; date: Date } | { kind: 'invalid' } | { kind: 'past' };

export function parseDeadline(text: string, now: Date): DateParse {
    const word = text.toLowerCase();
    const addDays = (days: number) =>
        ({ kind: 'ok', date: endOfDay(now.getFullYear(), now.getMonth(), now.getDate() + days) } as const);

    if (word in RELATIVE_DAYS) return addDays(RELATIVE_DAYS[word]);
    if (word in WEEKDAYS) {
        // The next such day; today's weekday means one week ahead.
        const ahead = (WEEKDAYS[word] - now.getDay() + 7) % 7 || 7;
        return addDays(ahead);
    }

    let date: Date | null = null;
    let yearGiven = true;
    let match = word.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        date = validDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    } else if ((match = word.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) {
        date = validDate(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    } else if ((match = word.match(/^(\d{1,2})\.(\d{1,2})\.?$/))) {
        yearGiven = false;
        date = validDate(now.getFullYear(), Number(match[2]) - 1, Number(match[1]));
        if (date && date < now) {
            // Without a year, a date that has passed means next year's.
            date = validDate(now.getFullYear() + 1, Number(match[2]) - 1, Number(match[1]));
        }
    }
    if (!date) return { kind: 'invalid' };
    if (yearGiven && date < now) return { kind: 'past' };
    return { kind: 'ok', date };
}

function deadlineLabel(date: Date, now: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear() === now.getFullYear() ? '' : String(date.getFullYear());
    return `${SHORT_WEEKDAY[date.getDay()]} ${dd}.${mm}.${year}`;
}

const normalize = (text: string) => text.toLowerCase().replace(/[\s\-_]+/g, '');

type ProjectMatch =
    | { kind: 'ok'; project: QuickAddContext['projects'][number] }
    | { kind: 'none' }
    | { kind: 'ambiguous'; names: string[] };

/** Exact name, then name ignoring spaces/dashes, then a unique prefix of
 *  the name, then a unique name with a word starting with the query. */
export function matchProject(query: string, projects: QuickAddContext['projects']): ProjectMatch {
    const lower = query.toLowerCase();
    const exact = projects.filter(p => p.header.toLowerCase() === lower);
    if (exact.length === 1) return { kind: 'ok', project: exact[0] };
    const normalized = projects.filter(p => normalize(p.header) === normalize(query));
    if (normalized.length === 1) return { kind: 'ok', project: normalized[0] };

    for (const candidates of [
        projects.filter(p => normalize(p.header).startsWith(normalize(query))),
        projects.filter(p => p.header.toLowerCase().split(/[\s\-_]+/).some(w => w.startsWith(lower))),
    ]) {
        if (candidates.length === 1) return { kind: 'ok', project: candidates[0] };
        if (candidates.length > 1) return { kind: 'ambiguous', names: candidates.map(p => p.header) };
    }
    return { kind: 'none' };
}

export function parseQuickAdd(text: string, context: QuickAddContext): QuickAddResult {
    const result: QuickAddResult = {
        header: '', durationMinutes: null, tags: { existing: [], new: [] },
        parentId: null, priority: null, deadline: null, tokens: [], errors: [],
    };
    const headerWords: string[] = [];
    const seen = { duration: false, project: false, priority: false, deadline: false };

    const add = (kind: QuickAddTokenKind, start: number, end: number, label: string) =>
        result.tokens.push({ kind, start, end, label });
    const fail = (start: number, end: number, label: string, message: string) => {
        result.tokens.push({ kind: 'error', start, end, label, message });
        result.errors.push(message);
    };
    /** The second duration/project/… is an error: the first one counts. */
    const once = (key: keyof typeof seen, start: number, end: number, word: string, what: string) => {
        if (!seen[key]) return (seen[key] = true);
        fail(start, end, word, `Only one ${what} per task — “${word}” was ignored.`);
        return false;
    };

    for (const match of text.matchAll(/\S+/g)) {
        const word = match[0];
        const start = match.index;
        const end = start + word.length;
        const rest = word.slice(1);

        if (word.startsWith('\\') && word.length > 1) {
            headerWords.push(rest);
        } else if (DURATION_RE.test(word)) {
            const parsed = parseDurationInput(word);
            const minutes = parsed.kind === 'ok' ? parsed.minutes : 0;
            if (minutes < 1 || minutes > MAX_DURATION_MINUTES) {
                fail(start, end, word, `“${word}” is not a usable duration. Use between 1 minute and 1000 hours, e.g. 30m or 1.5h.`);
            } else if (once('duration', start, end, word, 'duration')) {
                result.durationMinutes = minutes;
                add('duration', start, end, formatDuration(minutesToDurationString(minutes)));
            }
        } else if (word.startsWith('#') && rest) {
            const tag = context.tags.find(t => t.name.toLowerCase() === rest.toLowerCase());
            if (tag) {
                if (!result.tags.existing.includes(tag.id)) result.tags.existing.push(tag.id);
                add('tag', start, end, `#${tag.name}`);
            } else {
                if (!result.tags.new.some(name => name.toLowerCase() === rest.toLowerCase())) {
                    result.tags.new.push(rest);
                }
                add('newTag', start, end, `#${rest} (new)`);
            }
        } else if (word.startsWith('+') && rest) {
            const found = matchProject(rest, context.projects);
            if (found.kind === 'ok') {
                if (once('project', start, end, word, 'project')) {
                    result.parentId = found.project.id;
                    add('project', start, end, found.project.path ?? found.project.header);
                }
            } else if (found.kind === 'ambiguous') {
                fail(start, end, word, `“${word}” matches ${found.names.length} projects (${found.names.join(', ')}). Type more of the name.`);
            } else {
                fail(start, end, word, `There is no project called “${rest}”. Check the spelling or create the project first.`);
            }
        } else if (word.startsWith('!') && rest) {
            const value = PRIORITY_RE.test(rest) ? Number(rest.replace(',', '.')) : NaN;
            if (!(value >= 0 && value <= 10)) {
                fail(start, end, word, `“${word}” is not a priority. Use a number between 0 and 10, e.g. !7.`);
            } else if (once('priority', start, end, word, 'priority')) {
                result.priority = value;
                add('priority', start, end, `!${value}`);
            }
        } else if (word.startsWith('>') && rest) {
            const parsed = parseDeadline(rest, context.now);
            if (parsed.kind === 'invalid') {
                fail(start, end, word, `“${rest}” is not a valid date. Use e.g. >fri, >tomorrow, >3.10. or >2026-10-03.`);
            } else if (parsed.kind === 'past') {
                fail(start, end, word, `“${rest}” is in the past. Choose today or a later date.`);
            } else if (once('deadline', start, end, word, 'deadline')) {
                result.deadline = parsed.date;
                add('deadline', start, end, deadlineLabel(parsed.date, context.now));
            }
        } else {
            headerWords.push(word);
        }
    }
    result.header = headerWords.join(' ');
    return result;
}
