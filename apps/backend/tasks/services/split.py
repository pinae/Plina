"""Splitting a task into subtasks (UI-3; the split editor's save, §4).

``split_task`` applies the editor's rows in one transaction: the rows are the
complete new list of direct subtasks in order — a row with an ``id`` updates
that subtask, a row without one creates a new subtask, and existing subtasks
missing from the rows are removed. Rows may carry ``children`` of their own
(indenting in the editor splits that row too). Any error raises
``SplitError`` and rolls everything back.

Measurement data is never thrown away (§4.6): a subtask with tracked time,
with subtasks of its own, or already completed cannot be removed here.
"""
from __future__ import annotations

from typing import List, Optional

from django.db import transaction

from tasks.models import Task, TaskDependency
from tasks.services.estimates import record_estimate_change
from tasks.services.tree import dependency_cycle

UNSET = object()
DEFAULT_PRIORITY = Task._meta.get_field("priority").default


class SplitError(Exception):
    def __init__(self, detail: str, **extra):
        super().__init__(detail)
        self.payload = {"detail": detail, **extra}


@transaction.atomic
def split_task(parent: Task, rows: List[dict], *, estimate=UNSET, estimate_reason: str = "split",
               sequential: bool = True, inherit_tags: bool = True,
               inherit_priority: bool = True) -> List[Task]:
    """Apply the rows; returns the direct subtasks in their new order."""
    if parent.is_done:
        raise SplitError(f"“{parent.header}” is completed. Reopen it before splitting it.")
    if estimate is not UNSET:
        old = parent.duration
        parent.duration = estimate
        parent.save(update_fields=["duration"])
        record_estimate_change(parent, old, estimate, estimate_reason)
    options = dict(sequential=sequential, inherit_tags=inherit_tags,
                   inherit_priority=inherit_priority)
    return _apply_rows(parent, rows, **options)


def _removal_blocker(task: Task) -> Optional[str]:
    if task.is_done:
        return "it is already completed"
    if task.time_spent:
        return "time was already tracked on it"
    if task.children.exists():
        return "it has subtasks of its own"
    return None


def _apply_rows(parent: Task, rows: List[dict], *, sequential: bool, inherit_tags: bool,
                inherit_priority: bool) -> List[Task]:
    existing = {child.id: child for child in Task.objects.filter(parent=parent)}
    row_ids = [row["id"] for row in rows if row.get("id")]
    if len(row_ids) != len(set(row_ids)):
        raise SplitError("The same subtask appears twice in the list.")
    for row_id in row_ids:
        if row_id not in existing:
            stranger = Task.objects.filter(id=row_id).first()
            name = f"“{stranger.header}”" if stranger else "A task in the list"
            raise SplitError(f"{name} is not a subtask of “{parent.header}”. Move it there "
                             "first or add it as a new part.")

    for removed_id in set(existing) - set(row_ids):
        removed = existing[removed_id]
        reason = _removal_blocker(removed)
        if reason:
            raise SplitError(f"“{removed.header}” can’t be removed because {reason}. "
                             "Keep it in the list (or complete it instead).")
        removed.delete()

    parent_tags = list(parent.tags.all())
    options = dict(sequential=sequential, inherit_tags=inherit_tags,
                   inherit_priority=inherit_priority)
    result: List[Task] = []
    for order, row in enumerate(rows):
        if row.get("id"):
            task = existing[row["id"]]
            old = task.duration
            task.header = row["header"]
            if "duration" in row:
                task.duration = row["duration"]
            if "priority" in row:
                task.priority = row["priority"]
            task.order = order
            task.save()
            if "tag_ids" in row:
                task.tags.set(row["tag_ids"])
            record_estimate_change(task, old, task.duration, "split")
        else:
            default_priority = parent.priority if inherit_priority else DEFAULT_PRIORITY
            task = Task.objects.create(
                header=row["header"], duration=row.get("duration"), parent=parent, order=order,
                priority=row.get("priority", default_priority),
            )
            task.tags.set(row.get("tag_ids", parent_tags if inherit_tags else []))
            record_estimate_change(task, None, task.duration, "created")
        if row.get("children") is not None:
            _apply_rows(task, row["children"], **options)
        result.append(task)

    if sequential:
        for before, after in zip(result, result[1:]):
            if TaskDependency.objects.filter(predecessor=before, successor=after).exists():
                continue
            cycle = dependency_cycle(before.id, after.id)
            if cycle is not None:
                raise SplitError(
                    f"Doing these in this order would create a dependency cycle: “{after.header}” "
                    f"already has to happen before “{before.header}”. Untick “Do these in this "
                    "order” or remove that dependency.",
                    cycle=[str(node) for node in cycle],
                )
            TaskDependency.objects.create(predecessor=before, successor=after)
    return result
