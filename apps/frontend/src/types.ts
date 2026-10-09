/**
 * WP-7: TypeScript mirror of the backend serializers and planner payloads.
 *
 * Conventions inherited from DRF:
 * - UUIDs and datetimes are ISO strings.
 * - Model `DurationField`s serialize as "HH:MM:SS" (or "D HH:MM:SS") strings.
 * - Planner item durations are plain seconds (numbers) — see _serialize_item.
 */

import type { TaskFilter } from './utils/taskFilter.ts';

// ---------------------------------------------------------------- entities

export interface Tag {
    id: string;
    name: string;
    hex_color: string;
}

export interface Task {
    id: string;
    header: string;
    description: string;
    /** Where it takes place; "" = nowhere in particular. */
    place: string;
    start_date: string | null;
    duration: string | null;
    latest_finish_date: string | null;
    time_spent: string;
    priority: number;
    tags: Tag[];
    /** The color the task shows (§4.4): its own, else inherited. */
    hex_color: string | null;
    /** The chosen color; null = inherit (a project: automatic). */
    own_hex_color: string | null;
    /** What it shows without its own: the parent's, a project's automatic one. */
    inherited_hex_color: string | null;
    is_fixed: boolean;
    is_appointment: boolean;
    completed_at: string | null;
    is_done: boolean;
    active_tracking_start: string | null;
    // Task tree (UI-1).
    parent_id: string | null;
    order: number;
    children_ids: string[];
    /** Root first, excluding the task itself. */
    ancestor_ids: string[];
    /** Earliest deadline of the task and its ancestors. */
    effective_deadline: string | null;
    /** False = no own estimate; planned with the default duration. */
    is_estimated: boolean;
    /** Parents only (null for leaves): Σ of the children's estimates. */
    parts_total: string | null;
    /** Parents only: estimate − Σ parts − own time spent, never negative. */
    rest: string | null;
    over_budget: boolean;
    // Completion snapshot (§4.6), null while open.
    completion_estimate: string | null;
    completion_first_estimate: string | null;
    completion_time_spent: string | null;
    completion_subtree_time_spent: string | null;
    completion_dropped_rest: string | null;
    // Recurring tasks (README: Recurring tasks): every occurrence is a task
    // of its own; null/0 for a task that does not repeat.
    /** The rule as typed, e.g. "every tuesday at 20:00". */
    recurrence: string | null;
    /** The rule in normalized words: "every Tuesday at 20:00". */
    recurrence_description: string | null;
    series_id: string | null;
    /** The date this occurrence stands for (a task is due from then on). */
    occurrence: string | null;
    /** The series' next date after this occurrence. */
    next_occurrence: string | null;
    /** How many occurrences the series has, done ones included. */
    occurrence_count: number;
    /** The repeating calendar event its series follows (README: Calendar). */
    series_calendar: SeriesCalendar | null;
    /** A named deadline (README: Calendar): the deadline is this marker's start. */
    deadline_marker: { id: string; title: string; start: string } | null;
    /** The calendar event it follows (README: Calendar), null for a task of yours. */
    calendar: TaskCalendar | null;
}

/** A recurring task that follows a repeating calendar event. */
export interface SeriesCalendar {
    name: string;
    /** New occurrences join without asking (while they fit the rule). */
    auto: boolean;
    /** Why ``auto`` was switched off: an occurrence that did not fit. */
    mismatch: string;
}

/** The calendar event behind a task, as last read. */
export interface TaskCalendar {
    id: string;
    /** The calendar's name, e.g. "Google". */
    name: string;
    event: CalendarEvent;
    /** What the calendar changed but Plina kept (you had changed it). */
    pending: ('header' | 'description')[];
}

export interface CalendarEvent {
    header: string;
    description: string;
    place: string;
    start: string;
    end: string;
    all_day: boolean;
}

/** Fields accepted when creating/updating a task (tag_ids is write-only). */
export interface TaskWrite {
    header?: string;
    description?: string;
    start_date?: string | null;
    duration?: string | null;
    latest_finish_date?: string | null;
    time_spent?: string;
    priority?: number;
    tag_ids?: string[];
    is_fixed?: boolean;
    is_appointment?: boolean;
    completed_at?: string | null;
    parent_id?: string | null;
    order?: number;
    /** The chosen color (§4.4); null = inherit (a project: automatic). */
    own_hex_color?: string | null;
    /** Why the estimate changes (history); plain edits are "edited". */
    estimate_reason?: 'edited' | 'set_to_sum' | 'raised_from_warning';
    /** Repeats by this rule; "" stops a recurring task after this occurrence. */
    recurrence?: string;
    /** A recurring task's edit: this occurrence only, or the following open ones too. */
    scope?: 'this' | 'following';
    place?: string;
    /** A named deadline: the deadline follows this marker; null = a date of its own. */
    deadline_marker_id?: string | null;
    /** Compared with the calendar: what it changed and Plina kept is settled. */
    calendar_resolved?: boolean;
    /** Of the series that follows a repeating calendar event. */
    calendar_auto?: boolean;
}

/** Something on certain days or at a certain time (README: Calendar). */
export interface Marker {
    id: string;
    title: string;
    description: string;
    place: string;
    start: string;
    /** "HH:MM:SS" or "D HH:MM:SS". */
    duration: string;
    end: string;
    /** From midnight to midnight. */
    all_day: boolean;
    /** The calendar it comes from. */
    calendar: { id: string; name: string } | null;
    /** How many tasks have it as their deadline. */
    deadline_task_count: number;
}

export type MarkerWrite = Partial<Pick<Marker, 'title' | 'description' | 'place' | 'start' | 'duration'>>;

/** A calendar Plina reads (README: Calendar); the address is never sent back. */
export interface CalendarSubscription {
    id: string;
    name: string;
    /** E.g. "calendar.google.com …". */
    url_hint: string;
    email: string;
    hex_color: string;
    last_synced_at: string | null;
    last_error: string;
}

export interface CalendarSubscriptionWrite {
    name?: string;
    url?: string;
    email?: string;
    hex_color?: string;
}

export interface CalendarSyncResponse {
    changed: boolean;
    calendars: CalendarSubscription[];
}

export interface MergeResponse {
    task: Task;
    /** E.g. a dependency left out because it would have made a cycle. */
    notes: string[];
}

export interface TagWrite {
    name: string;
    hex_color?: string;
}

export interface BucketTypeWrite {
    name: string;
    start_times: string;
    duration: string;
    tag_ids?: string[];
    /** The chosen color; null = automatic (§4.4). */
    own_hex_color?: string | null;
    /** A special bucket's time frame (README: Calendar); both or neither. */
    special_start?: string | null;
    special_end?: string | null;
}

export interface RecurrencePreview {
    /** The rule in normalized words: "every weekday at 09:00". */
    description: string;
    occurrences: string[];
}

export interface TimeBucketType {
    id: number;
    name: string;
    start_times: string;
    duration: string;
    tags: Tag[];
    /** The color its buckets show: the chosen one, else the automatic one. */
    hex_color: string | null;
    /** The chosen color; null = automatic (§4.4). */
    own_hex_color: string | null;
    /** Its automatic color, unlike the other bucket types'. */
    auto_hex_color: string | null;
    /** A special bucket (README: Calendar): only within this time frame,
     *  where the regular buckets give way to it. */
    special_start?: string | null;
    special_end?: string | null;
    is_special?: boolean;
    /** The calendar event it was made from. */
    calendar?: { id: string; name: string } | null;
}

export interface TimeBucket {
    id: string;
    start_date: string;
    duration: string;
    type: TimeBucketType;
}

export interface Dependency {
    id: string;
    predecessor: string;
    successor: string;
}

/** 400 payload of POST /api/dependencies/ when an edge would close a cycle. */
export interface DependencyCycleError {
    /** DRF sends the message as a list (`["…"]`). */
    detail: string | string[];
    cycle?: string[];
}

// ---------------------------------------------------------------- planning

export interface PlanItem {
    task_id: string;
    header: string;
    /** A slice of a parent's Rest placeholder (UI-2): ``task_id`` is the
     *  parent, ``header`` reads "Rest of …". */
    is_rest?: boolean;
    start_time: string;
    /** Seconds. */
    duration: number;
    warnings: string[];
    is_fixed: boolean;
    is_appointment: boolean;
    hex_color: string | null;
    /** Present on entries of the accepted (stored) plan only. */
    order?: number;
}

export interface PlannedBucket {
    id: string;
    start_date: string;
    end_date: string;
    type_name: string;
    type_id: number;
    hex_color: string | null;
    /** False for generated (not yet materialized) buckets. */
    persisted: boolean;
    items: PlanItem[];
}

/** GET /api/plan/ — the accepted plan, or a live computation as fallback. */
export interface PlanResponse {
    accepted_plan_id: string | null;
    /** Feasibility warnings of the accepted plan (empty in fallback mode). */
    warnings: PlanWarning[];
    appointments: PlanItem[];
    buckets: PlannedBucket[];
}

export interface PlanWarning {
    task_id: string;
    header: string;
    kind: 'deadline_missed' | 'unplanned_within_horizon';
    deadline: string | null;
    projected_finish: string | null;
}

export interface ProjectFinish {
    project_id: string;
    name: string;
    finish: string;
}

export interface PlanMetrics {
    min_slack_seconds: number | null;
    context_switches: number;
    priority_earliness_hours: number | null;
    project_finishes: ProjectFinish[];
}

export interface PlanAlternative {
    /** Stored plan id — present when candidates were stored (POST / complete). */
    id?: string;
    label: string;
    /** What the option is about (docs/plan-chooser.md). */
    kind?: 'deadline_safe' | 'priority_first' | 'flow' | 'top_project' | 'recent_project' | 'project';
    project?: { id: string; name: string } | null;
    feasible: boolean;
    warnings: PlanWarning[];
    metrics: PlanMetrics;
    appointments: PlanItem[];
    buckets: PlannedBucket[];
}

export interface AlternativesResponse {
    alternatives: PlanAlternative[];
}

/** Stored plan meta as returned by /api/plans/ and the accept action. */
export interface StoredPlan {
    id: string;
    label: string;
    is_accepted: boolean;
    feasible: boolean;
    created_at: string;
    metrics: PlanMetrics;
    warnings: PlanWarning[];
}

// ---------------------------------------------------------------- tracking

/** Response of track/start, track/stop. */
export interface TrackingResponse {
    task: Task;
    /** track/start only: the task whose running session was closed by
     *  switching over (UI-3), null when nothing else was running. */
    stopped_task_id?: string | null;
    /** track/start only: settings after the active project followed the task. */
    settings?: UserSettings;
}

/** Response of POST tasks/{id}/move/ (T-1). */
export interface MoveResponse {
    task: Task;
}

/** Response of POST tasks/{id}/reopen/ (UI-2). */
export interface ReopenResponse {
    task: Task;
    /** The task and its reopened ancestors, bottom-up. */
    reopened: string[];
}

// -------------------------------------------------------------- settings

/** GET/PATCH /api/settings/ (UI-3). */
export interface UserSettings {
    /** DRF duration; used for tasks without an own estimate. */
    default_duration: string;
    /** Active project: a top-level task or a task with subtasks. */
    active_task_id: string | null;
    /** Breadcrumb of the active project, root first. */
    active_task_path: { id: string; header: string }[];
    /** IANA zone of the user's device ("Europe/Berlin"); recurring buckets
     *  ("every day at 14:00") follow it. Empty = the server's zone. */
    time_zone: string;
    /** The time frame the Week view opens on ("08:00:00" to "16:45:00"):
     *  the user's usual work hours. */
    week_view_start: string;
    week_view_end: string;
}

export interface SettingsWrite {
    default_duration?: string;
    active_task_id?: string | null;
    time_zone?: string;
    /** "HH:MM"; the end must be after the start. */
    week_view_start?: string;
    week_view_end?: string;
}

// ----------------------------------------------------------------- split

/** One row of the split editor; ``children`` splits the row itself. */
export interface SplitRow {
    /** Existing subtask to update; omit to create a new one. */
    id?: string;
    header: string;
    /** Null/omitted = unestimated (planned with the default duration). */
    duration?: string | null;
    priority?: number;
    /** ISO; must not be later than an ancestor's deadline. */
    latest_finish_date?: string | null;
    tag_ids?: string[];
    /** Omitted/null = keep this task's own subtree as it is. */
    children?: SplitRow[] | null;
}

/** Body of POST tasks/{id}/split/: ``children`` is the complete new list of
 *  direct subtasks in order; existing ones left out are removed. */
export interface SplitRequest {
    children: SplitRow[];
    estimate?: string | null;
    estimate_reason?: 'split' | 'set_to_sum' | 'raised_from_warning';
    /** Default true: adds dependencies row 1 → row 2 → … */
    sequential?: boolean;
    inherit_tags?: boolean;
    inherit_priority?: boolean;
}

export interface SplitResponse {
    task: Task;
    children: Task[];
}

/** Response of complete (nothing is re-planned, README: Planning light). */
export interface CompleteResponse {
    task: Task;
    /** Parents completed because their last open child was (bottom-up, UI-2). */
    auto_completed?: { id: string; header: string }[];
}

/** 400 payload of track/start when predecessors are unfinished. */
export interface TrackingBlockedError {
    detail: string;
    predecessors?: { id: string; header: string }[];
}

// ---------------------------------------------------------------- accounts

/** The logged-in user (README: Accounts). */
export interface SessionUser {
    username: string;
    /** Full name, else the user name. */
    name: string;
    email: string;
    /** Logged in with the single sign-on (no password of their own). */
    single_sign_on: boolean;
    can_change_password: boolean;
    is_staff: boolean;
}

/** GET /api/auth/session/: who is logged in, how one logs in, and the CSRF
 *  token every change must send (X-CSRFToken). */
export interface Session {
    authenticated: boolean;
    user: SessionUser | null;
    csrf_token: string;
    /** Offered when the server has OpenID Connect configured. */
    single_sign_on: { name: string; login_url: string } | null;
    /** "Forgot your password?" (Django's reset by mail), when it can send mail. */
    password_reset_url: string | null;
}

export interface LoginRequest {
    username: string;
    password: string;
}

export interface PasswordChange {
    old_password: string;
    new_password: string;
}

/** A task counted on a day of the time sheet (README: Time sheet). */
export interface TimeSheetEntry {
    task_id: string;
    header: string;
    tags: Tag[];
    /** #Arbeit/#Work: work; #Freizeit/#Freetime: a pause. */
    kind: 'work' | 'pause';
    /** Its time on that day (a pause: between begin and end only). */
    seconds: number;
    /** Being tracked right now. */
    running: boolean;
}

export interface TimeSheetDay {
    /** YYYY-MM-DD, the user's day. */
    date: string;
    /** The first and the last moment of work. */
    begin: string;
    end: string;
    /** Work is being tracked: the end is now. */
    running: boolean;
    pause_seconds: number;
    /** From begin to end without the pauses. */
    working_seconds: number;
    entries: TimeSheetEntry[];
}

export interface TimeSheet {
    from: string;
    to: string;
    /** The tag names that count as work / as a pause. */
    work_tags: string[];
    pause_tags: string[];
    days: TimeSheetDay[];
}

/** A stretch of tracked time on a task (README: Time sheet). */
export interface TrackedSession {
    id: string;
    task_id: string;
    task_header: string;
    task_tags: Tag[];
    start: string;
    /** Null while it is being tracked. */
    end: string | null;
    running: boolean;
    /** Until its end, or now. */
    seconds: number;
}

export interface TrackedSessionWrite {
    task_id?: string;
    start?: string;
    end?: string | null;
}

/** A named filter of the Tasks tab and the dependency editor (README:
 *  Filtering tasks), synced to all devices. */
export interface SavedFilter {
    id: string;
    name: string;
    filter: TaskFilter;
    created_at: string;
}

export interface SavedFilterWrite {
    name?: string;
    filter?: TaskFilter;
}
