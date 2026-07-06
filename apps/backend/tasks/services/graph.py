"""Pure graph helpers for the task dependency DAG.

All functions work on plain ``(predecessor_id, successor_id)`` edge tuples and
have no Django or database dependencies, so they are trivially unit-testable
and reusable by the planner (WP-2) and the API validation layer alike.
"""
from __future__ import annotations

from collections import defaultdict, deque
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
