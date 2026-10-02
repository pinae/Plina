import axios from 'axios';
import type {
    AlternativesResponse,
    BucketTypeWrite,
    CompleteResponse,
    Dependency,
    PlanResponse,
    RecurrencePreview,
    MoveResponse,
    ReopenResponse,
    SettingsWrite,
    SplitRequest,
    SplitResponse,
    StoredPlan,
    Tag,
    TagWrite,
    Task,
    TaskWrite,
    TimeBucket,
    TimeBucketType,
    TrackingResponse,
    UserSettings,
} from './types';

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

/** The API root of a backend given by its root URL (``VITE_BACKEND_URL``,
 *  without ``/api``); unset or empty means the local dev server. */
export const apiBaseUrl = (backendUrl?: string) =>
    `${backendUrl?.trim().replace(/\/+$/, '') || DEFAULT_BACKEND_URL}/api/`;

const api = axios.create({
    baseURL: apiBaseUrl(import.meta.env.VITE_BACKEND_URL),
    headers: {
        'Content-Type': 'application/json',
    },
});

export default api;

// ------------------------------------------------------------------- plan

/** The accepted plan (or a live computation when none is accepted). */
export const fetchPlan = () =>
    api.get<PlanResponse>('plan/').then(r => r.data);

/** Stateless preview — computes without storing candidates. */
export const previewAlternatives = () =>
    api.get<AlternativesResponse>('plan/alternatives/').then(r => r.data);

/** Computes AND stores candidates; alternatives carry acceptable ids. */
export const computeAlternatives = () =>
    api.post<AlternativesResponse>('plan/alternatives/').then(r => r.data);

export const acceptPlan = (planId: string) =>
    api.post<StoredPlan>(`plans/${planId}/accept/`).then(r => r.data);

// ----------------------------------------------------------------- tasks

export const fetchTasks = () =>
    api.get<Task[]>('tasks/').then(r => r.data);

export const fetchTask = (taskId: string) =>
    api.get<Task>(`tasks/${taskId}/`).then(r => r.data);

export const createTask = (task: TaskWrite) =>
    api.post<Task>('tasks/', task).then(r => r.data);

export const updateTask = (taskId: string, patch: TaskWrite) =>
    api.patch<Task>(`tasks/${taskId}/`, patch).then(r => r.data);

/** A task with subtasks needs ``children``: ``lift`` moves them up one
 *  level, ``delete`` removes the whole subtree (UI-1). */
export const deleteTask = (taskId: string, children?: 'lift' | 'delete') =>
    api.delete(`tasks/${taskId}/`, { params: children ? { children } : undefined })
        .then(() => undefined);

export const splitTask = (taskId: string, body: SplitRequest) =>
    api.post<SplitResponse>(`tasks/${taskId}/split/`, body).then(r => r.data);

/** T-1: new parent (null = top level) and position among its subtasks. */
export const moveTask = (taskId: string, parentId: string | null, index: number) =>
    api.post<MoveResponse>(`tasks/${taskId}/move/`, { parent_id: parentId, index }).then(r => r.data);

export const reopenTask = (taskId: string) =>
    api.post<ReopenResponse>(`tasks/${taskId}/reopen/`).then(r => r.data);

// -------------------------------------------------------------- settings

export const fetchSettings = () =>
    api.get<UserSettings>('settings/').then(r => r.data);

export const updateSettings = (patch: SettingsWrite) =>
    api.patch<UserSettings>('settings/', patch).then(r => r.data);

// -------------------------------------------------------------- tracking

export const startTracking = (taskId: string) =>
    api.post<TrackingResponse>(`tasks/${taskId}/track/start/`).then(r => r.data);

export const stopTracking = (taskId: string) =>
    api.post<TrackingResponse>(`tasks/${taskId}/track/stop/`).then(r => r.data);

export const completeTask = (taskId: string) =>
    api.post<CompleteResponse>(`tasks/${taskId}/complete/`).then(r => r.data);

// ---------------------------------------------------------- dependencies

export const fetchDependencies = () =>
    api.get<Dependency[]>('dependencies/').then(r => r.data);

export const createDependency = (edge: { predecessor: string; successor: string }) =>
    api.post<Dependency>('dependencies/', edge).then(r => r.data);

export const deleteDependency = (dependencyId: string) =>
    api.delete(`dependencies/${dependencyId}/`).then(() => undefined);

// -------------------------------------------------------- master data

export const fetchTags = () =>
    api.get<Tag[]>('tags/').then(r => r.data);


export const fetchBucketTypes = () =>
    api.get<TimeBucketType[]>('buckettypes/').then(r => r.data);

export const fetchTimeBuckets = () =>
    api.get<TimeBucket[]>('timebuckets/').then(r => r.data);

export const createTag = (tag: TagWrite) =>
    api.post<Tag>('tags/', tag).then(r => r.data);

export const updateTag = (tagId: string, patch: Partial<TagWrite>) =>
    api.patch<Tag>(`tags/${tagId}/`, patch).then(r => r.data);


export const createBucketType = (bucketType: BucketTypeWrite) =>
    api.post('buckettypes/', bucketType).then(r => r.data);

export const updateBucketType = (bucketTypeId: number, patch: Partial<BucketTypeWrite>) =>
    api.patch<TimeBucketType>(`buckettypes/${bucketTypeId}/`, patch).then(r => r.data);

export const previewRecurrence = (startTimes: string) =>
    api.post<RecurrencePreview>('recurrence-preview/', { start_times: startTimes })
        .then(r => r.data);
