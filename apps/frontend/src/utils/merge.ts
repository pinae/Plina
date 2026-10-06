/** What a merge of two tasks decides (README: Calendar), for the merge dialog. */
import type { Task } from '../types.ts';
import { minutesToDurationString } from './duration.ts';

/** One side of the comparison: the fields a merge decides. */
export interface MergeSide {
    header: string;
    description: string;
    place: string;
    is_appointment: boolean;
    start_date: string | null;
    duration: string | null;
    latest_finish_date: string | null;
    deadline_marker: { id: string; title: string } | null;
    priority: number;
    tag_ids: string[];
    parent_id: string | null;
}

export const sideOf = (task: Task): MergeSide => ({
    header: task.header, description: task.description, place: task.place ?? '',
    is_appointment: task.is_appointment, start_date: task.start_date, duration: task.duration,
    latest_finish_date: task.latest_finish_date, deadline_marker: task.deadline_marker,
    priority: task.priority, tag_ids: task.tags.map(tag => tag.id), parent_id: task.parent_id,
});

/** The calendar's version of an imported task (as last read). */
export const eventSideOf = (task: Task): MergeSide => {
    const event = task.calendar!.event;
    const minutes = Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60000);
    return {
        ...sideOf(task), header: event.header, description: event.description, place: event.place,
        is_appointment: true, start_date: event.start, duration: minutesToDurationString(minutes),
    };
};

/** The task the merge keeps: yours rather than one a calendar brought (its
 *  time, dependencies and place in the tree stay), else the drop target. */
export function keptOf(dragged: Task, target: Task): { kept: Task; other: Task } {
    if (dragged.calendar && !target.calendar) return { kept: target, other: dragged };
    if (target.calendar && !dragged.calendar) return { kept: dragged, other: target };
    return { kept: target, other: dragged };
}
