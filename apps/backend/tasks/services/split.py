"""Splitting a task into subtasks (UI-3/UI-6; the split editor's save, §4).

``split_task`` applies the editor's rows in one transaction. The rows are the
complete new outline below the task, in order and nested via ``children``:

* a row with an ``id`` updates that task — any task of the subtree, so the
  editor can move parts between levels (indent/outdent);
* a row without one creates a new subtask;
* a row with an ``id`` and without ``children`` leaves that task's own
  subtree as it is;
* every other task of the subtree that is not in the rows is removed.

Any error raises ``SplitError`` and rolls everything back. Measurement data
is never thrown away (§4.6): a task with tracked time or already completed
cannot be removed here.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Set
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from tasks.models import Task, TaskDependency
from tasks.services.estimates import record_estimate_change
from tasks.services.tree import TreeIndex, current_dependency_cycle, dependency_cycle

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
    if parent.series_id is not None:
        from tasks.services.series import subtasks_refused
        raise SplitError(subtasks_refused(parent))
    if estimate is not UNSET:
        old = parent.duration
        parent.duration = estimate
        parent.save(update_fields=["duration"])
        record_estimate_change(parent, old, estimate, estimate_reason)

    tree = TreeIndex.load()
    subtree = set(tree.descendant_ids(parent.id))
    existing = {task.id: task for task in Task.objects.filter(id__in=subtree)}
    kept = _check_rows(parent, rows, subtree, tree)
    _remove(existing, subtree - kept, tree)

    applier = _RowApplier(sequential=sequential, inherit_tags=inherit_tags,
                          inherit_priority=inherit_priority, existing=existing)
    children = applier.apply(parent, rows)

    cycle = current_dependency_cycle()
    if cycle is not None:
        names = dict(Task.objects.filter(id__in=cycle).values_list("id", "header"))
        raise SplitError(
            "This outline would create a dependency cycle, because a parent’s dependencies apply "
            f"to all of its subtasks: {' → '.join(f'“{names.get(node, node)}”' for node in cycle)}.",
            cycle=[str(node) for node in cycle],
        )
    return children


def _check_rows(parent: Task, rows: List[dict], subtree: Set[UUID], tree: TreeIndex) -> Set[UUID]:
    """Validate the ids; returns every task of the subtree that stays."""
    seen: List[UUID] = []
    kept: Set[UUID] = set()

    def walk(level: List[dict]):
        for row in level:
            row_id = row.get("id")
            if row_id:
                if row_id not in subtree:
                    stranger = Task.objects.filter(id=row_id).first()
                    name = f"“{stranger.header}”" if stranger else "A task in the list"
                    raise SplitError(f"{name} is not part of “{parent.header}”. Move it there "
                                     "first or add it as a new part.")
                seen.append(row_id)
                kept.add(row_id)
                if row.get("children") is None:
                    kept.update(tree.descendant_ids(row_id))  # untouched subtree
            if row.get("children") is not None:
                walk(row["children"])

    walk(rows)
    if len(seen) != len(set(seen)):
        raise SplitError("The same subtask appears twice in the outline.")
    return kept


def _removal_blocker(task: Task) -> Optional[str]:
    if task.is_done:
        return "it is already completed"
    if task.time_spent:
        return "time was already tracked on it"
    return None


def _remove(existing: Dict[UUID, Task], removed: Set[UUID], tree: TreeIndex) -> None:
    for task_id in removed:
        reason = _removal_blocker(existing[task_id])
        if reason:
            raise SplitError(f"“{existing[task_id].header}” can’t be removed because {reason}. "
                             "Keep it in the outline (or complete it instead).")
    # Children before parents (the tree protects parents from cascades); a
    # removed task's kept children have already been moved elsewhere below.
    by_depth = sorted(removed, key=lambda task_id: len(tree.ancestor_ids(task_id)), reverse=True)
    for task_id in by_depth:
        Task.objects.filter(parent_id=task_id).exclude(id__in=removed).update(parent=None)
        Task.objects.filter(id=task_id).delete()


class _RowApplier:
    def __init__(self, *, sequential: bool, inherit_tags: bool, inherit_priority: bool,
                 existing: Dict[UUID, Task]):
        self.sequential = sequential
        self.inherit_tags = inherit_tags
        self.inherit_priority = inherit_priority
        self.existing = existing

    def apply(self, parent: Task, rows: List[dict]) -> List[Task]:
        parent_tags = list(parent.tags.all())
        result: List[Task] = []
        for order, row in enumerate(rows):
            task = self._update(row, parent, order) if row.get("id") else self._create(row, parent, order, parent_tags)
            if "tag_ids" in row:
                task.tags.set(row["tag_ids"])
            self._check_deadline(task, parent)
            if row.get("children") is not None:
                self.apply(task, row["children"])
            result.append(task)
        if self.sequential:
            self._chain(result)
        return result

    def _update(self, row: dict, parent: Task, order: int) -> Task:
        task = self.existing[row["id"]]
        old = task.duration
        task.header = row["header"]
        task.parent = parent
        task.order = order
        for field in ("duration", "priority", "latest_finish_date"):
            if field in row:
                setattr(task, field, row[field])
        task.save()
        record_estimate_change(task, old, task.duration, "split")
        return task

    def _create(self, row: dict, parent: Task, order: int, parent_tags: list) -> Task:
        default_priority = parent.priority if self.inherit_priority else DEFAULT_PRIORITY
        task = Task.objects.create(
            header=row["header"], duration=row.get("duration"), parent=parent, order=order,
            priority=row.get("priority", default_priority),
            latest_finish_date=row.get("latest_finish_date"),
        )
        if "tag_ids" not in row:
            task.tags.set(parent_tags if self.inherit_tags else [])
        record_estimate_change(task, None, task.duration, "created")
        return task

    @staticmethod
    def _check_deadline(task: Task, parent: Task) -> None:
        if task.latest_finish_date is None:
            return
        current, seen = parent, set()
        while current is not None and current.id not in seen:
            seen.add(current.id)
            if current.latest_finish_date and task.latest_finish_date > current.latest_finish_date:
                shown = timezone.localtime(current.latest_finish_date).strftime("%d.%m.%Y %H:%M")
                raise SplitError(f"The deadline of “{task.header}” is later than the deadline of "
                                 f"“{current.header}” ({shown}). Choose a date on or before it.")
            current = current.parent

    @staticmethod
    def _chain(tasks: List[Task]) -> None:
        for before, after in zip(tasks, tasks[1:]):
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
