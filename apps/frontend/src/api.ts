import axios from 'axios';
import type {
    AlternativesResponse,
    CompleteResponse,
    Dependency,
    PlanResponse,
    Project,
    StoredPlan,
    Tag,
    Task,
    TaskWrite,
    TimeBucket,
    TrackingResponse,
} from './types';

const api = axios.create({
    baseURL: 'http://localhost:8000/api/',
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

export const deleteTask = (taskId: string) =>
    api.delete(`tasks/${taskId}/`).then(() => undefined);

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

export const fetchProjects = () =>
    api.get<Project[]>('projects/').then(r => r.data);

export const fetchTimeBuckets = () =>
    api.get<TimeBucket[]>('timebuckets/').then(r => r.data);
