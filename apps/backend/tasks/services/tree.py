"""Task tree (UI-1, docs/task-entry-ui.md §2 and §10).

Every top-level task is a project; tasks can be split indefinitely via
``Task.parent``. This module holds the tree rules:

* ``TreeIndex`` — an in-memory snapshot of the whole tree (one query) that
  answers structural questions (children, ancestors, descendants) and the
  budget numbers (Σ parts, Rest, over budget, effective deadline) without
  per-task queries.
* validation helpers for re-parenting (no cycles) and deadlines (a child's
  deadline may not be later than an ancestor's);
* ``delete_task`` with the two explicit modes for a parent's children.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional
from uuid import UUID

from django.db import transaction
from django.db.models import Max

from tasks.models import Task

#: Estimate used for unestimated tasks until the user setting exists (UI-3).
DEFAULT_DURATION = timedelta(hours=1)


class TreeError(Exception):
    """Domain error; the API maps it to a 400 with ``payload``."""

    def __init__(self, detail: str, **extra):
        super().__init__(detail)
        self.payload = {"detail": detail, **extra}


@dataclass(frozen=True)
class TreeNode:
    id: UUID
    parent_id: Optional[UUID]
    header: str
    order: int
    duration: Optional[timedelta]
    latest_finish_date: Optional[datetime]
    time_spent: timedelta


class TreeIndex:
    """Read-only snapshot of the task tree."""

    FIELDS = ("id", "parent_id", "header", "order", "duration",
              "latest_finish_date", "time_spent")

    def __init__(self, nodes: Iterable[TreeNode], default_duration: timedelta = DEFAULT_DURATION):
        self.nodes: Dict[UUID, TreeNode] = {node.id: node for node in nodes}
        self.default_duration = default_duration
        self._children: Dict[Optional[UUID], List[UUID]] = {}
        for node in sorted(self.nodes.values(), key=lambda n: (n.order, n.header, str(n.id))):
            self._children.setdefault(node.parent_id, []).append(node.id)

    @classmethod
    def load(cls) -> "TreeIndex":
        return cls(TreeNode(**row) for row in Task.objects.values(*cls.FIELDS))

    # Structure --------------------------------------------------------------

    def children_ids(self, task_id: UUID) -> List[UUID]:
        return list(self._children.get(task_id, []))

    def has_children(self, task_id: UUID) -> bool:
        return bool(self._children.get(task_id))

    def ancestor_ids(self, task_id: UUID) -> List[UUID]:
        """Root first, excluding the task itself."""
        chain: List[UUID] = []
        parent = self.nodes[task_id].parent_id
        while parent is not None and parent not in chain:
            chain.append(parent)
            parent = self.nodes[parent].parent_id if parent in self.nodes else None
        return list(reversed(chain))

    def root_id(self, task_id: UUID) -> Optional[UUID]:
        """The top-level ancestor, or None for a top-level task itself."""
        ancestors = self.ancestor_ids(task_id)
        return ancestors[0] if ancestors else None

    def descendant_ids(self, task_id: UUID) -> List[UUID]:
        """Depth-first, in sibling order."""
        result: List[UUID] = []
        for child in self._children.get(task_id, []):
            result.append(child)
            result.extend(self.descendant_ids(child))
        return result

    # Budget -----------------------------------------------------------------

    def estimate(self, task_id: UUID) -> timedelta:
        duration = self.nodes[task_id].duration
        return duration if duration is not None else self.default_duration

    def parts_total(self, task_id: UUID) -> Optional[timedelta]:
        children = self._children.get(task_id)
        if not children:
            return None
        return sum((self.estimate(child) for child in children), timedelta(0))

    def rest(self, task_id: UUID) -> Optional[timedelta]:
        parts = self.parts_total(task_id)
        if parts is None:
            return None
        left = self.estimate(task_id) - parts - self.nodes[task_id].time_spent
        return max(left, timedelta(0))

    def over_budget(self, task_id: UUID) -> bool:
        parts = self.parts_total(task_id)
        return parts is not None and parts > self.estimate(task_id)

    def effective_deadline(self, task_id: UUID) -> Optional[datetime]:
        deadlines = [self.nodes[i].latest_finish_date for i in [*self.ancestor_ids(task_id), task_id]]
        deadlines = [d for d in deadlines if d is not None]
        return min(deadlines) if deadlines else None

    def subtree_time_spent(self, task_id: UUID) -> timedelta:
        return sum((self.nodes[i].time_spent for i in self.descendant_ids(task_id)), timedelta(0))


# Validation -----------------------------------------------------------------

def _parent_map() -> Dict[UUID, Optional[UUID]]:
    return dict(Task.objects.values_list("id", "parent_id"))


def reparent_cycle(task_id: UUID, new_parent_id: Optional[UUID]) -> Optional[List[UUID]]:
    """The path ``[task, …, new_parent]`` if moving ``task`` under
    ``new_parent`` would put it inside its own subtree, else None."""
    if new_parent_id is None:
        return None
    if new_parent_id == task_id:
        return [task_id]
    parents = _parent_map()
    chain = [new_parent_id]
    current = parents.get(new_parent_id)
    while current is not None and current not in chain:
        chain.append(current)
        if current == task_id:
            return list(reversed(chain))
        current = parents.get(current)
    return None


def earliest_ancestor_deadline(parent: Optional[Task]) -> Optional[Task]:
    """The ancestor (starting with ``parent``) with the earliest deadline."""
    earliest = None
    seen = set()
    while parent is not None and parent.id not in seen:
        seen.add(parent.id)
        if parent.latest_finish_date is not None and (
                earliest is None or parent.latest_finish_date < earliest.latest_finish_date):
            earliest = parent
        parent = parent.parent
    return earliest


def next_sibling_order(parent_id: Optional[UUID]) -> int:
    highest = Task.objects.filter(parent_id=parent_id).aggregate(Max("order"))["order__max"]
    return 0 if highest is None else highest + 1


# Deletion -------------------------------------------------------------------

LIFT = "lift"
DELETE = "delete"


@transaction.atomic
def delete_task(task: Task, children_mode: Optional[str]) -> None:
    """Delete ``task``. A parent needs an explicit choice (§4.5): ``lift``
    moves its children into its place, ``delete`` removes the subtree."""
    if children_mode not in (None, LIFT, DELETE):
        raise TreeError(f"Unknown children mode “{children_mode}”. Use “lift” or “delete”.")
    children = list(Task.objects.filter(parent=task).order_by("order", "header"))
    if children and children_mode is None:
        raise TreeError(
            f"“{task.header}” has {len(children)} children. Choose whether to move them up "
            "one level (?children=lift) or delete them too (?children=delete).",
            children=len(children),
        )
    if children_mode == DELETE:
        index = TreeIndex.load()
        for descendant_id in reversed(index.descendant_ids(task.id)):  # leaves first
            Task.objects.filter(id=descendant_id).delete()
    elif children:
        siblings = list(Task.objects.filter(parent_id=task.parent_id).exclude(id=task.id)
                        .order_by("order", "header"))
        position = sum(1 for sibling in siblings if (sibling.order, sibling.header)
                       < (task.order, task.header))
        reordered = siblings[:position] + children + siblings[position:]
        for order, sibling in enumerate(reordered):
            Task.objects.filter(id=sibling.id).update(parent_id=task.parent_id, order=order)
    task.delete()
