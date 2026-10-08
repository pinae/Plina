import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type {
    AlternativesResponse,
    BucketTypeWrite,
    CalendarSubscription,
    CalendarSubscriptionWrite,
    CalendarSyncResponse,
    CompleteResponse,
    Marker,
    MarkerWrite,
    MergeResponse,
    Dependency,
    PlanResponse,
    RecurrencePreview,
    SavedFilter,
    SavedFilterWrite,
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
    TimeSheet,
    TrackedSession,
    TrackedSessionWrite,
    TrackingResponse,
    UserSettings,
    LoginRequest,
    PasswordChange,
    Session,
} from './types';

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

/** The API root of a backend given by its root URL (``VITE_BACKEND_URL``,
 *  without ``/api``); unset or empty means the local dev server, ``/`` the
 *  page's own origin (the Docker image, where nginx proxies ``/api/``). */
export const apiBaseUrl = (backendUrl?: string) => {
    const root = backendUrl?.trim();
    return `${root ? root.replace(/\/+$/, '') : DEFAULT_BACKEND_URL}/api/`;
};

const api = axios.create({
    baseURL: apiBaseUrl(import.meta.env.VITE_BACKEND_URL),
    headers: {
        'Content-Type': 'application/json',
    },
    // The session cookie (the login), also for a backend on another port.
    withCredentials: true,
});

export default api;

/** A page of the backend itself (e.g. the single sign-on), as a URL. */
export const backendUrl = (path: string) =>
    apiBaseUrl(import.meta.env.VITE_BACKEND_URL).replace(/api\/$/, '') + path.replace(/^\//, '');

// ---------------------------------------------------------------- session

// Every change sends the CSRF token the last session response carried.
let csrfToken: string | null = null;
const SAFE_METHODS = new Set(['get', 'head', 'options']);
const unauthorizedListeners = new Set<() => void>();

/** Called whenever the server answers 401: nobody is logged in (any more). */
export const onUnauthorized = (listener: () => void) => {
    unauthorizedListeners.add(listener);
    return () => { unauthorizedListeners.delete(listener); };
};

api.interceptors.request.use(config => {
    if (csrfToken && !SAFE_METHODS.has((config.method ?? 'get').toLowerCase())) {
        config.headers.set('X-CSRFToken', csrfToken);
    }
    return config;
});

api.interceptors.response.use(undefined, async (error: AxiosError<{ detail?: unknown }>) => {
    const config = error.config as (InternalAxiosRequestConfig & { csrfRetried?: boolean }) | undefined;
    const status = error.response?.status;
    if (status === 401) unauthorizedListeners.forEach(listener => listener());
    // A token rotated meanwhile (a login in another tab): fetch the current
    // one and try once more.
    if (status === 403 && config && !config.csrfRetried && /CSRF/i.test(String(error.response?.data?.detail ?? ''))) {
        config.csrfRetried = true;
        await fetchSession();
        return api.request(config);
    }
    throw error;
});

const remember = (session: Session) => {
    csrfToken = session.csrf_token;
    return session;
};

export const fetchSession = () =>
    api.get<Session>('auth/session/').then(r => remember(r.data));

export const login = (credentials: LoginRequest) =>
    api.post<Session>('auth/login/', credentials).then(r => remember(r.data));

/** ``redirect``: where to go to log out at the single sign-on, too. */
export const logout = () =>
    api.post<{ redirect: string | null }>('auth/logout/').then(r => r.data);

export const changePassword = (change: PasswordChange) =>
    api.post<Session>('auth/password/', change).then(r => remember(r.data));

// ------------------------------------------------------------------- plan

/** The accepted plan (or a live computation when none is accepted). */
export const fetchPlan = () =>
    api.get<PlanResponse>('plan/').then(r => r.data);

/** "Re-plan" (README: Planning light): the accepted plan reflowed around
 *  what happened; nothing else re-plans. */
export const recalculatePlan = () =>
    api.post<PlanResponse>('plan/recalculate/').then(r => r.data);

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
/** ``children``: what happens to a parent's subtasks; ``occurrences: 'all'``
 *  deletes every occurrence of a recurring task (else only this one). */
export const deleteTask = (taskId: string, children?: 'lift' | 'delete', occurrences?: 'all') =>
    api.delete(`tasks/${taskId}/`, {
        params: children || occurrences ? { ...(children ? { children } : {}), ...(occurrences ? { occurrences } : {}) } : undefined,
    }).then(() => undefined);

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

/** The tag goes; its tasks and time buckets keep everything else. */
export const deleteTag = (tagId: string) =>
    api.delete(`tags/${tagId}/`).then(() => undefined);


export const createBucketType = (bucketType: BucketTypeWrite) =>
    api.post('buckettypes/', bucketType).then(r => r.data);

export const updateBucketType = (bucketTypeId: number, patch: Partial<BucketTypeWrite>) =>
    api.patch<TimeBucketType>(`buckettypes/${bucketTypeId}/`, patch).then(r => r.data);

export const previewRecurrence = (startTimes: string) =>
    api.post<RecurrencePreview>('recurrence-preview/', { start_times: startTimes })
        .then(r => r.data);

/** The Repeats field's preview: the first occurrences from ``start`` (an
 *  appointment's) or now, as the task would get them. */
export const previewTaskRecurrence = (recurrence: string, start?: string | null) =>
    api.post<RecurrencePreview>('recurrence-preview/', { recurrence, ...(start ? { start } : {}) })
        .then(r => r.data);

// ------------------------------------------------------- calendar (README: Calendar)

export const fetchMarkers = () =>
    api.get<Marker[]>('markers/').then(r => r.data);

export const createMarker = (marker: MarkerWrite) =>
    api.post<Marker>('markers/', marker).then(r => r.data);

export const updateMarker = (markerId: string, patch: MarkerWrite) =>
    api.patch<Marker>(`markers/${markerId}/`, patch).then(r => r.data);

export const deleteMarker = (markerId: string) =>
    api.delete(`markers/${markerId}/`).then(() => undefined);

/** The marker becomes a special bucket (body as for a bucket type). */
export const convertMarker = (markerId: string, bucketType: Partial<BucketTypeWrite>) =>
    api.post<TimeBucketType>(`markers/${markerId}/convert/`, bucketType).then(r => r.data);

export const deleteBucketType = (bucketTypeId: number) =>
    api.delete(`buckettypes/${bucketTypeId}/`).then(() => undefined);

export const fetchCalendars = () =>
    api.get<CalendarSubscription[]>('calendars/').then(r => r.data);

export const createCalendar = (calendar: CalendarSubscriptionWrite) =>
    api.post<CalendarSubscription>('calendars/', calendar).then(r => r.data);

export const updateCalendar = (calendarId: string, patch: CalendarSubscriptionWrite) =>
    api.patch<CalendarSubscription>(`calendars/${calendarId}/`, patch).then(r => r.data);

export const deleteCalendar = (calendarId: string) =>
    api.delete(`calendars/${calendarId}/`).then(() => undefined);

/** Reads the calendars not read for a while (``force``: all now). */
export const syncCalendars = (force = false) =>
    api.post<CalendarSyncResponse>('calendars/sync/', force ? { force } : {}).then(r => r.data);

/** Merge ``otherId`` into ``keptId``: ``values`` are the merged fields. */
export const mergeTasks = (keptId: string, otherId: string, values: TaskWrite) =>
    api.post<MergeResponse>(`tasks/${keptId}/merge/`, { other_id: otherId, values }).then(r => r.data);

// ------------------------------------------------------ time sheet (README: Time sheet)

/** The days from ``from`` to ``to`` (YYYY-MM-DD, both included) with tracked work. */
export const fetchTimeSheet = (from: string, to: string) =>
    api.get<TimeSheet>('timesheet/', { params: { from, to } }).then(r => r.data);

/** Tracked time: a task's (``task``) or that begun on days (``from``, ``to``). */
export const fetchSessions = (params: { task?: string; from?: string; to?: string }) =>
    api.get<TrackedSession[]>('sessions/', { params }).then(r => r.data);

export const createSession = (session: TrackedSessionWrite) =>
    api.post<TrackedSession>('sessions/', session).then(r => r.data);

export const updateSession = (sessionId: string, patch: TrackedSessionWrite) =>
    api.patch<TrackedSession>(`sessions/${sessionId}/`, patch).then(r => r.data);

export const deleteSession = (sessionId: string) =>
    api.delete(`sessions/${sessionId}/`).then(() => undefined);

// ------------------------------------------- saved filters (README: Filtering tasks)

export const fetchSavedFilters = () =>
    api.get<SavedFilter[]>('saved-filters/').then(r => r.data);

export const createSavedFilter = (saved: SavedFilterWrite) =>
    api.post<SavedFilter>('saved-filters/', saved).then(r => r.data);

export const updateSavedFilter = (savedId: string, patch: SavedFilterWrite) =>
    api.patch<SavedFilter>(`saved-filters/${savedId}/`, patch).then(r => r.data);

export const deleteSavedFilter = (savedId: string) =>
    api.delete(`saved-filters/${savedId}/`).then(() => undefined);
