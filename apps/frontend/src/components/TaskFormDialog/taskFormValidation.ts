/**
 * Validation for the task form.
 *
 * Pure functions so every rule is unit-testable. Each kind of problem (empty,
 * malformatted, out of range, …) has its own plain-language message that says
 * what is wrong *and* how to fix it.
 */

export type TaskField =
    | 'header' | 'description' | 'hours' | 'deadline'
    | 'priority' | 'tags' | 'project' | 'start';

export interface TaskFormValues {
    header: string;
    description: string;
    /** Raw duration text as typed (hours, h:mm or minutes). */
    hours: string;
    /** datetime-local value; '' when empty. */
    deadline: string;
    /** The browser reported a partially typed date (validity.badInput). */
    deadlineIncomplete: boolean;
    priority: number;
    tagIds: string[];
    projectId: string;
    isAppointment: boolean;
    start: string;
    startIncomplete: boolean;
}

export interface ValidationContext {
    now: Date;
    /** Ids of existing tags/projects; null while still loading (checks skipped). */
    knownTagIds: string[] | null;
    knownProjectIds: string[] | null;
    /** Original values in edit mode: an unchanged past deadline stays allowed. */
    originalDeadline?: string;
}

export type TaskFormErrors = Partial<Record<TaskField, string>>;

export const HEADER_MAX_LENGTH = 1024; // Task.header max_length in the backend
export const MAX_DURATION_HOURS = 1000;

// ------------------------------------------------------------------ parsing

export type DurationParse =
    | { kind: 'empty' }
    | { kind: 'invalid' }
    | { kind: 'ok'; minutes: number };

const NUMBER = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`;
const HOURS_RE = new RegExp(String.raw`^${NUMBER}\s*(?:h|hrs?|hours?)?$`);
const MINUTES_RE = new RegExp(String.raw`^${NUMBER}\s*(?:m|mins?|minutes?)$`);
const HHMM_RE = /^(\d+):([0-5]\d)$/;

const toNumber = (text: string) => parseFloat(text.replace(',', '.'));

/** Parse "1.5", "1,5", "2h", "1:30", "90m" … into whole minutes (sign kept). */
export function parseDurationInput(text: string): DurationParse {
    let raw = text.trim().toLowerCase();
    if (!raw) return { kind: 'empty' };
    let sign = 1;
    if (raw.startsWith('-')) {
        sign = -1;
        raw = raw.slice(1).trim();
    }
    let match = raw.match(HHMM_RE);
    if (match) return { kind: 'ok', minutes: sign * (Number(match[1]) * 60 + Number(match[2])) };
    match = raw.match(MINUTES_RE);
    if (match) return { kind: 'ok', minutes: sign * Math.round(toNumber(match[1])) };
    match = raw.match(HOURS_RE);
    if (match) return { kind: 'ok', minutes: sign * Math.round(toNumber(match[1]) * 60) };
    return { kind: 'invalid' };
}

/** Minutes -> the friendliest duration text for the input field. */
export function formatHoursInput(minutes: number): string {
    if (minutes % 60 === 0) return String(minutes / 60);
    const hours = Math.round((minutes / 60) * 100) / 100;
    if (Math.abs(hours * 60 - minutes) < 1e-9) return String(hours);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

type DateParse = { kind: 'empty' } | { kind: 'incomplete' } | { kind: 'invalid' } | { kind: 'ok'; date: Date };

function parseLocalDateTime(value: string, incomplete: boolean): DateParse {
    if (!value.trim()) return incomplete ? { kind: 'incomplete' } : { kind: 'empty' };
    if (!LOCAL_DATETIME_RE.test(value)) return { kind: 'invalid' };
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? { kind: 'invalid' } : { kind: 'ok', date };
}

const formatDateTime = (date: Date) =>
    date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// --------------------------------------------------------------- validation

export function validateTaskForm(values: TaskFormValues, context: ValidationContext): TaskFormErrors {
    const errors: TaskFormErrors = {};

    // Header — required, limited by the database column.
    const header = values.header.trim();
    if (!header) {
        errors.header = 'The header is empty. Give the task a short name, e.g. “Write report”.';
    } else if (header.length > HEADER_MAX_LENGTH) {
        errors.header = `The header is too long (${header.length} characters, at most `
            + `${HEADER_MAX_LENGTH}). Shorten it — details belong in the description.`;
    }

    // Description — optional; any text (including none) is fine.

    // Duration — required so the planner knows how much time to reserve.
    const duration = parseDurationInput(values.hours);
    let durationMinutes: number | null = null;
    if (duration.kind === 'empty') {
        errors.hours = 'The duration is empty. Enter how long the task will take, e.g. 1.5 hours (or 1:30).';
    } else if (duration.kind === 'invalid') {
        errors.hours = `“${values.hours.trim()}” is not a valid duration. Enter hours as a number like `
            + '1.5 or 1,5, as hours:minutes like 1:30, or minutes like 90m.';
    } else if (duration.minutes < 0) {
        errors.hours = "The duration can't be negative. Remove the minus sign.";
    } else if (duration.minutes === 0) {
        errors.hours = 'The duration must be at least 1 minute. For 15 minutes enter 0.25 or 15m.';
    } else if (duration.minutes > MAX_DURATION_HOURS * 60) {
        errors.hours = `${values.hours.trim()} hours is more than ${MAX_DURATION_HOURS} hours. `
            + 'Split the work into smaller tasks or check for a typo.';
    } else {
        durationMinutes = duration.minutes;
    }

    // Appointment start — required only for appointments.
    let start: Date | null = null;
    if (values.isAppointment) {
        const parsed = parseLocalDateTime(values.start, values.startIncomplete);
        if (parsed.kind === 'empty') {
            errors.start = 'An appointment needs a start time. Pick the date and time it begins.';
        } else if (parsed.kind === 'incomplete') {
            errors.start = 'The start time is incomplete. Fill in both the date and the time.';
        } else if (parsed.kind === 'invalid') {
            errors.start = `“${values.start}” is not a valid date and time. Pick the start from the date picker.`;
        } else {
            start = parsed.date;
        }
    }

    // Deadline — optional, but if given it must be usable.
    const deadline = parseLocalDateTime(values.deadline, values.deadlineIncomplete);
    if (deadline.kind === 'incomplete') {
        errors.deadline = 'The deadline is incomplete. Fill in both the date and the time, '
            + 'or clear the field if there is no deadline.';
    } else if (deadline.kind === 'invalid') {
        errors.deadline = `“${values.deadline}” is not a valid date and time. Pick the deadline from the date picker.`;
    } else if (deadline.kind === 'ok') {
        const changed = values.deadline !== context.originalDeadline;
        const appointmentEnd = start && durationMinutes !== null
            ? new Date(start.getTime() + durationMinutes * 60000)
            : null;
        if (changed && deadline.date < context.now) {
            errors.deadline = `The deadline (${formatDateTime(deadline.date)}) is in the past. `
                + 'Pick a future date and time, or clear the field.';
        } else if (appointmentEnd && deadline.date < appointmentEnd) {
            errors.deadline = `The deadline (${formatDateTime(deadline.date)}) is before the appointment `
                + `ends (${formatDateTime(appointmentEnd)}). Move the deadline later or remove it.`;
        }
    }

    // Priority — the slider keeps it in range; guard anyway.
    if (!Number.isFinite(values.priority) || values.priority < 0 || values.priority > 10) {
        errors.priority = 'Priority must be between 0 and 10.';
    }

    // Tags / project — selections must still exist (they may have been deleted).
    if (context.knownTagIds && values.tagIds.some(id => !context.knownTagIds!.includes(id))) {
        errors.tags = 'A selected tag no longer exists (it may have been deleted). Remove it from the selection.';
    }
    if (context.knownProjectIds && values.projectId && !context.knownProjectIds.includes(values.projectId)) {
        errors.project = 'The selected project no longer exists. Choose another project or “No project”.';
    }

    return errors;
}

// ------------------------------------------------------------ server errors

const SERVER_FIELD: Record<string, TaskField> = {
    header: 'header', description: 'description', duration: 'hours',
    latest_finish_date: 'deadline', priority: 'priority', tag_ids: 'tags',
    project_id: 'project', start_date: 'start',
};

/** Map a DRF 400 payload ({field: [messages]}) onto form fields; anything that
 *  is not a known field is returned as a general message. */
export function mapServerErrors(data: unknown): { fields: TaskFormErrors; general: string | null } {
    const fields: TaskFormErrors = {};
    const general: string[] = [];
    if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            const text = Array.isArray(value) ? value.join(' ') : String(value);
            const field = SERVER_FIELD[key];
            if (field) fields[field] = `The server rejected this value: ${text}`;
            else general.push(text);
        }
    }
    return { fields, general: general.length ? general.join(' ') : null };
}
