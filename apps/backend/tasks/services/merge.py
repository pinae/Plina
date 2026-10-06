"""Merging two tasks into one (README: Calendar): e.g. your own task for a
meeting and the invitation the calendar brought. The fields come from the
merge dialog (applied by the caller through the task serializer); this
moves over everything else: tracked time and sessions, dependencies,
subtasks and calendar links, then deletes the other task."""
from __future__ import annotations

from typing import List

from django.db import transaction

from tasks.models import CalendarLink, Task, TaskDependency, TrackingSession, UserSettings
from tasks.services.tree import TreeIndex, dependency_cycle, next_sibling_order


class MergeError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.payload = {"detail": detail}


def merge_refusal(kept: Task, other: Task) -> str | None:
    """Why ``other`` cannot be merged into ``kept``, or None."""
    if kept.id == other.id:
        return "A task cannot be merged with itself."
    tree = TreeIndex.load()
    for inner, outer in ((kept, other), (other, kept)):
        if outer.id in tree.ancestor_ids(inner.id):
            return f"“{inner.header}” is part of “{outer.header}”. Move it out first to merge them."
    if kept.series_id is not None and Task.objects.filter(parent=other).exists():
        return f"“{kept.header}” repeats and cannot take over the subtasks of “{other.header}”."
    if CalendarLink.objects.filter(task=kept).exists() and CalendarLink.objects.filter(task=other).exists():
        return ("Both come from a calendar. Merge each with a task of yours instead — "
                "one task follows one calendar event.")
    return None


@transaction.atomic
def merge_into(kept: Task, other: Task) -> List[str]:
    """Move ``other``'s time, sessions, dependencies, subtasks and calendar
    links to ``kept`` and delete ``other``. Returns notes for the user (e.g.
    a dependency left out because it would have made a cycle)."""
    refusal = merge_refusal(kept, other)
    if refusal:
        raise MergeError(refusal)
    notes = []
    kept.time_spent += other.time_spent
    kept.save(update_fields=["time_spent"])
    TrackingSession.objects.filter(task=other).update(task=kept)
    for dependency in list(TaskDependency.objects.filter(predecessor=other)) + \
            list(TaskDependency.objects.filter(successor=other)):
        predecessor = kept.id if dependency.predecessor_id == other.id else dependency.predecessor_id
        successor = kept.id if dependency.successor_id == other.id else dependency.successor_id
        dependency.delete()
        if predecessor == successor or TaskDependency.objects.filter(predecessor_id=predecessor,
                                                                      successor_id=successor).exists():
            continue
        if dependency_cycle(predecessor, successor) is not None:
            notes.append("A dependency was left out: it would have made a cycle.")
            continue
        TaskDependency.objects.create(predecessor_id=predecessor, successor_id=successor)
    order = next_sibling_order(kept.id)
    for child in Task.objects.filter(parent=other).order_by("order", "header"):
        child.parent, child.order = kept, order
        child.save(update_fields=["parent", "order"])
        order += 1
    CalendarLink.objects.filter(task=other).update(task=kept, owned=False)
    CalendarLink.objects.filter(task=kept).update(owned=False)  # yours now: stays when the event goes
    UserSettings.objects.filter(active_task=other).update(active_task=kept)
    if other.series_id is not None:
        from tasks.services.series import delete_occurrence
        delete_occurrence(other)
    else:
        other.delete()
    return notes
