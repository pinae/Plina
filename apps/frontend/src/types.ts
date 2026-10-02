/**
 * WP-7: TypeScript mirror of the backend serializers and planner payloads.
 *
 * Conventions inherited from DRF:
 * - UUIDs and datetimes are ISO strings.
 * - Model `DurationField`s serialize as "HH:MM:SS" (or "D HH:MM:SS") strings.
 * - Planner item durations are plain seconds (numbers) — see _serialize_item.
 */

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
}

export interface RecurrencePreview {
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
    detail: string;
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
    /** Client-only: false when a manual placement made this auto-planned item
     *  impossible as planned; it fades until the next re-plan. Server omits it
     *  (treated as valid). */
    valid?: boolean;
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
}

export interface SettingsWrite {
    default_duration?: string;
    active_task_id?: string | null;
    time_zone?: string;
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

/** Response of complete: choices are embedded when the frontier forks. */
export interface CompleteResponse {
    task: Task;
    alternatives: PlanAlternative[];
    /** Parents completed because their last open child was (bottom-up, UI-2). */
    auto_completed?: { id: string; header: string }[];
}

/** 400 payload of track/start when predecessors are unfinished. */
export interface TrackingBlockedError {
    detail: string;
    predecessors?: { id: string; header: string }[];
}
