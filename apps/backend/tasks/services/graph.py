"""Pure graph helpers for the task dependency DAG.

All functions work on plain ``(predecessor_id, successor_id)`` edge tuples and
have no Django or database dependencies, so they are trivially unit-testable
and reusable by the planner (WP-2) and the API validation layer alike.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Hashable, Iterable, List, Optional, Tuple

Edge = Tuple[Hashable, Hashable]


def _adjacency(edges: Iterable[Edge]) -> Dict[Hashable, List[Hashable]]:
    adjacency: Dict[Hashable, List[Hashable]] = defaultdict(list)
    for predecessor, successor in edges:
        adjacency[predecessor].append(successor)
    return adjacency


def find_path(edges: Iterable[Edge], start: Hashable, end: Hashable) -> Optional[List[Hashable]]:
    """Shortest directed path from ``start`` to ``end`` (BFS), or ``None``."""
    if start == end:
        return [start]

    adjacency = _adjacency(edges)
    predecessors: Dict[Hashable, Hashable] = {}
    queue = deque([start])
    visited = {start}

    while queue:
        node = queue.popleft()
        for neighbor in adjacency[node]:
            if neighbor in visited:
                continue
            predecessors[neighbor] = node
            if neighbor == end:
                return _reconstruct(predecessors, start, end)
            visited.add(neighbor)
            queue.append(neighbor)
    return None


def _reconstruct(predecessors: Dict[Hashable, Hashable], start: Hashable, end: Hashable) -> List[Hashable]:
    path = [end]
    while path[-1] != start:
        path.append(predecessors[path[-1]])
    path.reverse()
    return path


def would_create_cycle(edges: Iterable[Edge], new_edge: Edge) -> Optional[List[Hashable]]:
    """Check whether adding ``new_edge`` to the DAG would close a cycle.

    Returns the full cycle path (first node repeated at the end, e.g.
    ``[a, b, c, a]``) if a cycle would arise, otherwise ``None``.

    A new edge ``predecessor -> successor`` closes a cycle exactly when
    ``predecessor`` is already reachable from ``successor``.
    """
    predecessor, successor = new_edge
    if predecessor == successor:
        return [predecessor, predecessor]

    edge_list = list(edges)
    if new_edge in edge_list:
        # A duplicate cannot introduce a cycle the graph does not already have.
        return None

    path = find_path(edge_list, successor, predecessor)
    if path is None:
        return None
    return path + [successor]


class CycleError(Exception):
    """The dependency graph contains a cycle and cannot be planned."""

    def __init__(self, cycle: List[Hashable]):
        self.cycle = cycle
        super().__init__(f"Dependency cycle: {' -> '.join(str(node) for node in cycle)}")


class DependencyGraph:
    """In-memory DAG over planning nodes.

    Nodes are any objects exposing ``id``, ``remaining_duration``,
    ``latest_finish_date``, ``tag_ids`` and ``project_id`` (structural
    typing — :class:`~tasks.services.planner_service.PlanningTask` fits).
    """

    def __init__(self, nodes: Dict[Hashable, object], edges: List[Edge]):
        self.nodes = nodes
        self.edges = edges
        self.successors: Dict[Hashable, List[Hashable]] = {node_id: [] for node_id in nodes}
        self.predecessors: Dict[Hashable, List[Hashable]] = {node_id: [] for node_id in nodes}
        for predecessor, successor in edges:
            self.successors[predecessor].append(successor)
            self.predecessors[successor].append(predecessor)


def build_dag(nodes: Iterable[object], edges: Iterable[Edge]) -> DependencyGraph:
    """Build a :class:`DependencyGraph`, dropping edges to unknown nodes.

    Unknown endpoints are typically completed tasks that were filtered out
    upstream — their finish-to-start constraints are already satisfied.
    Raises :class:`CycleError` if the remaining edges contain a cycle.
    """
    node_map = {node.id: node for node in nodes}
    relevant_edges = [
        (predecessor, successor) for predecessor, successor in edges
        if predecessor in node_map and successor in node_map
    ]
    cycle = _find_any_cycle(node_map.keys(), relevant_edges)
    if cycle is not None:
        raise CycleError(cycle)
    return DependencyGraph(node_map, relevant_edges)


def _find_any_cycle(node_ids: Iterable[Hashable], edges: List[Edge]) -> Optional[List[Hashable]]:
    """Kahn's algorithm; if nodes remain, extract one concrete cycle path."""
    in_degree = {node_id: 0 for node_id in node_ids}
    adjacency = _adjacency(edges)
    for _, successor in edges:
        in_degree[successor] += 1

    queue = deque(node_id for node_id, degree in in_degree.items() if degree == 0)
    seen = 0
    while queue:
        node = queue.popleft()
        seen += 1
        for successor in adjacency[node]:
            in_degree[successor] -= 1
            if in_degree[successor] == 0:
                queue.append(successor)

    if seen == len(in_degree):
        return None
    # Some node sits on a cycle: walk within the residual graph until we repeat.
    residual = {node_id for node_id, degree in in_degree.items() if degree > 0}
    start = next(iter(residual))
    path, visited = [start], {start}
    node = start
    while True:
        node = next(succ for succ in adjacency[node] if succ in residual)
        if node in visited:
            return path[path.index(node):] + [node]
        path.append(node)
        visited.add(node)


def topological_order(graph: DependencyGraph) -> List[Hashable]:
    """Deterministic Kahn order: ties resolve by node insertion order."""
    in_degree = {node_id: len(preds) for node_id, preds in graph.predecessors.items()}
    queue = deque(node_id for node_id in graph.nodes if in_degree[node_id] == 0)
    order: List[Hashable] = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for successor in graph.successors[node]:
            in_degree[successor] -= 1
            if in_degree[successor] == 0:
                queue.append(successor)
    return order


def frontier(graph: DependencyGraph) -> List[Hashable]:
    """Tasks with no unfinished predecessors — startable right now."""
    return [node_id for node_id in graph.nodes if not graph.predecessors[node_id]]


def reachable_from(graph: DependencyGraph, start: Hashable) -> set:
    """All nodes reachable from ``start`` (including itself)."""
    result = {start}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        for successor in graph.successors[node]:
            if successor not in result:
                result.add(successor)
                queue.append(successor)
    return result


@dataclass(frozen=True)
class Branch:
    """One independent choice at the frontier: a startable task and everything behind it."""
    frontier_task_id: Hashable
    project_id: Optional[Hashable]
    task_ids: frozenset


def branches(graph: DependencyGraph) -> List[Branch]:
    """The user's real choices: per frontier task, its reachable sub-DAG."""
    return [
        Branch(
            frontier_task_id=frontier_id,
            project_id=getattr(graph.nodes[frontier_id], "project_id", None),
            task_ids=frozenset(reachable_from(graph, frontier_id)),
        )
        for frontier_id in frontier(graph)
    ]


@dataclass(frozen=True)
class CapacityWindow:
    """A block of plannable time; empty ``tag_ids`` accepts every task."""
    start: datetime
    end: datetime
    tag_ids: frozenset = frozenset()

    def accepts(self, task_tag_ids: frozenset) -> bool:
        return not self.tag_ids or bool(self.tag_ids & task_tag_ids)


class CapacityTimeline:
    """Answers "when could this much work finish/start?" against bucket capacity.

    Both directions ignore competition between tasks: this is the *optimistic
    bound* used by Phase 0 — if even this bound misses a deadline, the deadline
    is certainly unreachable and must be reported.
    """

    def __init__(self, windows: Iterable[CapacityWindow]):
        self.windows = sorted(windows, key=lambda window: window.start)

    def finish_after(self, ready: datetime, duration: timedelta,
                     task_tag_ids: frozenset) -> Optional[datetime]:
        """Earliest moment ``duration`` of matching capacity after ``ready`` is used up."""
        remaining = duration
        for window in self.windows:
            if not window.accepts(task_tag_ids):
                continue
            begin = max(window.start, ready)
            if begin >= window.end:
                continue
            available = window.end - begin
            if available >= remaining:
                return begin + remaining
            remaining -= available
        return None

    def start_before(self, deadline: datetime, duration: timedelta,
                     task_tag_ids: frozenset) -> Optional[datetime]:
        """Latest moment work may start so ``duration`` still fits before ``deadline``."""
        remaining = duration
        for window in reversed(self.windows):
            if not window.accepts(task_tag_ids):
                continue
            end = min(window.end, deadline)
            if end <= window.start:
                continue
            available = end - window.start
            if available >= remaining:
                return end - remaining
            remaining -= available
        return None


@dataclass(frozen=True)
class ScheduleEstimate:
    """Per-task result of the forward/backward pass.

    ``None`` values mean "unconstrained" for the latest/slack fields and
    "impossible within the horizon" for ``earliest_finish``.
    """
    earliest_start: Optional[datetime]
    earliest_finish: Optional[datetime]
    latest_start: Optional[datetime] = None
    latest_finish: Optional[datetime] = None

    @property
    def slack(self) -> Optional[timedelta]:
        if self.latest_finish is None or self.earliest_finish is None:
            return None
        return self.latest_finish - self.earliest_finish


def analyze(graph: DependencyGraph, timeline: CapacityTimeline,
            now: datetime) -> Dict[Hashable, ScheduleEstimate]:
    """Forward and backward pass over the DAG against available capacity."""
    order = topological_order(graph)

    earliest: Dict[Hashable, tuple] = {}
    for node_id in order:
        node = graph.nodes[node_id]
        predecessor_finishes = [earliest[pred][1] for pred in graph.predecessors[node_id]]
        if any(finish is None for finish in predecessor_finishes):
            earliest[node_id] = (None, None)
            continue
        ready = max([now, *predecessor_finishes])
        finish = timeline.finish_after(ready, node.remaining_duration, node.tag_ids)
        earliest[node_id] = (ready, finish)

    latest: Dict[Hashable, tuple] = {}
    for node_id in reversed(order):
        node = graph.nodes[node_id]
        bounds = [node.latest_finish_date] if node.latest_finish_date else []
        bounds.extend(
            latest[succ][0] for succ in graph.successors[node_id]
            if latest[succ][0] is not None
        )
        if not bounds:
            latest[node_id] = (None, None)
            continue
        latest_finish = min(bounds)
        latest_start = timeline.start_before(
            latest_finish, node.remaining_duration, node.tag_ids
        )
        latest[node_id] = (latest_start, latest_finish)

    return {
        node_id: ScheduleEstimate(
            earliest_start=earliest[node_id][0],
            earliest_finish=earliest[node_id][1],
            latest_start=latest[node_id][0],
            latest_finish=latest[node_id][1],
        )
        for node_id in graph.nodes
    }


def _binding_predecessor_path(graph: DependencyGraph,
                              estimates: Dict[Hashable, ScheduleEstimate],
                              end: Hashable) -> List[Hashable]:
    """Walk backward from ``end`` along the predecessor that dictates its start."""
    path = [end]
    node_id = end
    while True:
        predecessors = graph.predecessors[node_id]
        candidates = [
            pred for pred in predecessors
            if estimates[pred].earliest_finish is not None
            and estimates[pred].earliest_finish == estimates[node_id].earliest_start
        ]
        if not candidates:
            break
        node_id = max(candidates, key=lambda pred: estimates[pred].earliest_finish)
        path.append(node_id)
    path.reverse()
    return path


def critical_chain(graph: DependencyGraph,
                   estimates: Dict[Hashable, ScheduleEstimate]) -> List[Hashable]:
    """The dependency path with the least slack, ending at its deadline holder."""
    constrained = [
        node_id for node_id, estimate in estimates.items() if estimate.slack is not None
    ]
    if not constrained:
        return []
    tightest = min(constrained, key=lambda node_id: estimates[node_id].slack)

    # Walk forward to the node whose own deadline creates the pressure.
    end = tightest
    while True:
        successors = [
            succ for succ in graph.successors[end]
            if estimates[succ].slack is not None
        ]
        if not successors:
            break
        end = min(successors, key=lambda succ: estimates[succ].slack)

    return _binding_predecessor_path(graph, estimates, end)


@dataclass(frozen=True)
class FeasibilityWarning:
    """A hard constraint that cannot be met with the current buckets/deadlines."""
    task_id: Hashable
    deadline: Optional[datetime]
    projected_finish: Optional[datetime]
    chain: List[Hashable]


def feasibility_warnings(graph: DependencyGraph, timeline: CapacityTimeline,
                         now: datetime) -> List[FeasibilityWarning]:
    """All certainly-unmeetable constraints, each with its binding chain.

    Two kinds: a deadline the optimistic bound already misses, and a task
    that cannot be finished at all because no matching capacity exists in
    the horizon.
    """
    estimates = analyze(graph, timeline, now)
    warnings: List[FeasibilityWarning] = []
    for node_id in topological_order(graph):
        node = graph.nodes[node_id]
        estimate = estimates[node_id]
        deadline = node.latest_finish_date

        if estimate.earliest_finish is None:
            predecessors_ok = all(
                estimates[pred].earliest_finish is not None
                for pred in graph.predecessors[node_id]
            )
            if predecessors_ok:  # report the first unschedulable task, not its victims
                warnings.append(FeasibilityWarning(
                    task_id=node_id, deadline=deadline, projected_finish=None,
                    chain=_binding_predecessor_path(graph, estimates, node_id),
                ))
        elif deadline is not None and estimate.earliest_finish > deadline:
            warnings.append(FeasibilityWarning(
                task_id=node_id, deadline=deadline,
                projected_finish=estimate.earliest_finish,
                chain=_binding_predecessor_path(graph, estimates, node_id),
            ))
    return warnings
