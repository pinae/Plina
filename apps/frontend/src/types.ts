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
    hex_color: string | null;
    is_fixed: boolean;
    is_appointment: boolean;
    completed_at: string | null;
    is_done: boolean;
    active_tracking_start: string | null;
    project_id: string | null;
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
    project_id?: string | null;
}

export interface TagWrite {
    name: string;
    hex_color?: string;
}

export interface ProjectWrite {
    name: string;
    description?: string;
    priority?: number;
    tag_ids?: string[];
}

export interface BucketTypeWrite {
    name: string;
    start_times: string;
    duration: string;
    tag_ids?: string[];
}

export interface RecurrencePreview {
    occurrences: string[];
}

export interface Project {
    id: string;
    name: string;
    description: string;
    tags: Tag[];
    priority: number;
    /** Project-level ordering integer (not the task list!). */
    order: number;
    /** Task ids in project order — the task->project mapping. */
    task_ids: string[];
    hex_color: string | null;
}

export interface TimeBucketType {
    id: number;
    name: string;
    start_times: string;
    duration: string;
    tags: Tag[];
    hex_color: string | null;
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
    start_time: string;
    /** Seconds. */
    duration: number;
    warnings: string[];
    is_fixed: boolean;
    is_appointment: boolean;
    hex_color: string | null;
    /** Present on entries of the accepted (stored) plan only. */
    order?: number;
    /** Client-only: an auto-planned item made stale by a manual placement,
     *  faded until the next re-plan. Never sent by the server. */
    outdated?: boolean;
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
}

/** Response of complete: choices are embedded when the frontier forks. */
export interface CompleteResponse {
    task: Task;
    alternatives: PlanAlternative[];
}

/** 400 payload of track/start when predecessors are unfinished. */
export interface TrackingBlockedError {
    detail: string;
    predecessors?: { id: string; header: string }[];
    open_task_id?: string;
}
