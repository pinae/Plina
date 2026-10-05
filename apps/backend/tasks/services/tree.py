"""Task tree (UI-1, docs/task-entry-ui.md §2 and §10).

Every top-level task is a project; tasks can be split indefinitely via
``Task.parent``. This module holds the tree rules:

* ``TreeIndex`` — an in-memory snapshot of the whole tree (one query) that
  answers structural questions (children, ancestors, descendants), the
  budget numbers (Σ parts, Rest, over budget, effective deadline) and the
  colors tasks show (§4.4) without per-task queries.
* validation helpers for re-parenting (no cycles) and deadlines (a child's
  deadline may not be later than an ancestor's);
* ``delete_task`` with the two explicit modes for a parent's children.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Set, Tuple
from uuid import UUID

from django.db import transaction
from django.db.models import Max

from tasks.models import Task
from tasks.services.colors import FALLBACK_COLOR, to_hex

#: Fallback estimate for unestimated tasks; the user's setting (UI-3) wins.
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
    color: Optional[bytes] = None
    auto_color: Optional[bytes] = None


class TreeIndex:
    """Read-only snapshot of the task tree."""

    FIELDS = ("id", "parent_id", "header", "order", "duration",
              "latest_finish_date", "time_spent", "color", "auto_color")

    def __init__(self, nodes: Iterable[TreeNode], default_duration: timedelta = DEFAULT_DURATION):
        self.nodes: Dict[UUID, TreeNode] = {node.id: node for node in nodes}
        self.default_duration = default_duration
        self._children: Dict[Optional[UUID], List[UUID]] = {}
        for node in sorted(self.nodes.values(), key=lambda n: (n.order, n.header, str(n.id))):
            self._children.setdefault(node.parent_id, []).append(node.id)

    @classmethod
    def load(cls) -> "TreeIndex":
        from tasks.services.settings import default_duration
        return cls((TreeNode(**row) for row in Task.objects.values(*cls.FIELDS)),
                   default_duration=default_duration())

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

    # Colors (§4.4, services.colors) -------------------------------------------

    def inherited_color(self, task_id: UUID) -> str:
        """What the task shows without a color of its own: the nearest
        ancestor's color, else its project's automatic one."""
        ancestors = self.ancestor_ids(task_id)
        for ancestor in reversed(ancestors):
            if self.nodes[ancestor].color is not None:
                return to_hex(self.nodes[ancestor].color)
        root = self.nodes[ancestors[0] if ancestors else task_id]
        return to_hex(root.auto_color) if root.auto_color is not None else FALLBACK_COLOR

    def effective_color(self, task_id: UUID) -> str:
        """The color the task shows: its own, else the inherited one."""
        own = self.nodes[task_id].color
        return to_hex(own) if own is not None else self.inherited_color(task_id)


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


# Dependencies on the tree (UI-2) ---------------------------------------------

def _units_of(task_id: UUID, tree: TreeIndex, unit_ids: Set[UUID]) -> List[UUID]:
    """Planning units in ``task_id``'s subtree: open leaves and positive Rests
    (a Rest is planned under its parent's id)."""
    if task_id not in tree.nodes:
        return [task_id] if task_id in unit_ids else []
    return [unit for unit in [task_id, *tree.descendant_ids(task_id)] if unit in unit_ids]


def expand_edges(edges: Iterable[Tuple[UUID, UUID]], tree: TreeIndex,
                 unit_ids: Set[UUID]) -> List[Tuple[UUID, UUID]]:
    """Translate task-level dependencies into edges between planning units.

    * ``P → X`` becomes an edge from every unit of P's subtree to every unit
      of X's subtree (a parent's predecessors apply to all its descendants;
      depending on a parent means waiting for its whole subtree).
    * A parent's Rest comes after its children when the children are ordered
      among themselves ("do these in this order"): it follows every child
      that has no successor among its siblings.
    """
    edges = list(edges)
    result: Set[Tuple[UUID, UUID]] = set()
    for predecessor, successor in edges:
        for before in _units_of(predecessor, tree, unit_ids):
            for after in _units_of(successor, tree, unit_ids):
                if before != after:
                    result.add((before, after))
    for parent in unit_ids:
        if parent not in tree.nodes or not tree.has_children(parent):
            continue  # not a Rest unit
        children = set(tree.children_ids(parent))
        internal = [(p, s) for p, s in edges if p in children and s in children]
        if not internal:
            continue
        with_successor = {p for p, _ in internal}
        for child in children - with_successor:
            for unit in _units_of(child, tree, unit_ids):
                result.add((unit, parent))
    return sorted(result, key=lambda edge: (str(edge[0]), str(edge[1])))


def _start_end_edges(parents: Dict[UUID, Optional[UUID]],
                     dependencies: Iterable[Tuple[UUID, UUID]]) -> List[tuple]:
    """Each task as a Start and an End node: a parent starts before and ends
    after its children, a dependency ``P → S`` links P's end to S's start.
    A cycle in this graph is exactly a cycle between planning units."""
    edges = []
    for task_id, parent_id in parents.items():
        edges.append((("S", task_id), ("E", task_id)))
        if parent_id is not None:
            edges.append((("S", parent_id), ("S", task_id)))
            edges.append((("E", task_id), ("E", parent_id)))
    edges.extend((("E", p), ("S", s)) for p, s in dependencies)
    return edges


def _task_path(nodes: List[tuple]) -> List[UUID]:
    path: List[UUID] = []
    for _, task_id in nodes:
        if not path or path[-1] != task_id:
            path.append(task_id)
    return path


def _dependency_edges() -> List[Tuple[UUID, UUID]]:
    from tasks.models import TaskDependency
    return list(TaskDependency.objects.values_list("predecessor_id", "successor_id"))


def related_in_tree(a: UUID, b: UUID) -> Optional[Tuple[UUID, UUID]]:
    """``(inner, outer)`` if one task is part of the other's subtree."""
    parents = _parent_map()

    def is_inside(inner, outer):
        current = parents.get(inner)
        seen = set()
        while current is not None and current not in seen:
            if current == outer:
                return True
            seen.add(current)
            current = parents.get(current)
        return False

    if is_inside(a, b):
        return a, b
    if is_inside(b, a):
        return b, a
    return None


def dependency_cycle(predecessor_id: UUID, successor_id: UUID) -> Optional[List[UUID]]:
    """The cycle (``[a, …, a]``) a new dependency would close, counting the
    tree (dependencies of parents apply to their subtrees), else None."""
    from tasks.services.graph import would_create_cycle
    edges = _start_end_edges(_parent_map(), _dependency_edges())
    path = would_create_cycle(edges, (("E", predecessor_id), ("S", successor_id)))
    return _task_path(path) if path else None


def _cycle_in(parents: Dict[UUID, Optional[UUID]]) -> Optional[List[UUID]]:
    from tasks.services.graph import _find_any_cycle
    edges = _start_end_edges(parents, _dependency_edges())
    nodes = {node for edge in edges for node in edge}
    cycle = _find_any_cycle(nodes, edges)
    return _task_path(cycle) if cycle else None


def move_creates_dependency_cycle(task_id: UUID, new_parent_id: Optional[UUID]) -> Optional[List[UUID]]:
    """The cycle moving ``task_id`` under ``new_parent_id`` would create."""
    parents = _parent_map()
    parents[task_id] = new_parent_id
    return _cycle_in(parents)


def current_dependency_cycle() -> Optional[List[UUID]]:
    """A cycle in the tree + dependencies as they are stored right now (used
    after bulk changes inside a transaction, which then rolls back)."""
    return _cycle_in(_parent_map())


# Moving (T-1, docs/tasks-tab.md) ---------------------------------------------

def parent_change_error(task: Task, new_parent: Optional[Task]) -> Optional[dict]:
    """Why ``task`` cannot go under ``new_parent`` (a 400 payload), or None.
    Shared by PATCH ``parent_id`` and the move endpoint."""
    if new_parent is not None and new_parent.series_id is not None:
        from tasks.services.series import subtasks_refused
        return {"parent_id": [subtasks_refused(new_parent)]}
    path = reparent_cycle(task.id, new_parent.id if new_parent else None)
    if path is not None:
        if len(path) == 1:
            message = "A task cannot be its own parent."
        else:
            message = (f"“{task.header}” cannot be moved into “{new_parent.header}” "
                       f"because “{new_parent.header}” is part of “{task.header}”.")
        return {"parent_id": [message], "path": [str(node) for node in path]}
    cycle = move_creates_dependency_cycle(task.id, new_parent.id if new_parent else None)
    if cycle is not None:
        target = f"“{new_parent.header}”" if new_parent else "the top level"
        return {
            "parent_id": [f"Moving “{task.header}” into {target} would create a dependency "
                          "cycle, because a parent’s dependencies apply to all of its subtasks."],
            "cycle": [str(node) for node in cycle],
        }
    return None


class MoveError(Exception):
    def __init__(self, payload: dict):
        super().__init__(payload)
        self.payload = payload


def _renumber(parent_id: Optional[UUID], ordered: List[Task]) -> None:
    for order, sibling in enumerate(ordered):
        if sibling.order != order or sibling.parent_id != parent_id:
            Task.objects.filter(id=sibling.id).update(parent_id=parent_id, order=order)


@transaction.atomic
def move_task(task: Task, new_parent: Optional[Task], index: int) -> Task:
    """Put ``task`` (with its subtree) under ``new_parent`` at ``index`` among
    the new siblings — counted without the task itself, clamped to the end.
    Old and new sibling lists are renumbered 0, 1, 2 … Moving never
    completes anything: a parent that loses its last subtask stays open and
    becomes an ordinary task again."""
    if task.is_done:
        raise MoveError({"detail": f"“{task.header}” is completed. Reopen it first to move it."})
    if new_parent is not None and new_parent.is_done:
        raise MoveError({"parent_id": [
            f"“{new_parent.header}” is completed. Reopen it first or choose an open task."]})
    error = parent_change_error(task, new_parent)
    if error is not None:
        raise MoveError(error)

    old_parent_id = task.parent_id
    new_parent_id = new_parent.id if new_parent else None
    siblings = list(Task.objects.select_for_update()
                    .filter(parent_id=new_parent_id).exclude(id=task.id)
                    .order_by("order", "header"))
    position = max(0, min(index, len(siblings)))
    _renumber(new_parent_id, siblings[:position] + [task] + siblings[position:])
    if old_parent_id != new_parent_id:
        _renumber(old_parent_id, list(Task.objects.filter(parent_id=old_parent_id)
                                      .order_by("order", "header")))
    task.refresh_from_db()
    return task

