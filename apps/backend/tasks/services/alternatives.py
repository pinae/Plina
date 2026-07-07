"""Generation of alternative plans (WP-4, §6 Phases 1 & 3).

A dependency DAG usually admits many valid topological orderings.  Instead of
enumerating them, this module finds the *meaningful* choices:

* one candidate per frontier **branch** ("start with the Blog" vs. "start with
  the Webshop") — only where the graph actually leaves a choice, and
* three **weight presets** (deadline-safe / priority-first / flow) that trade
  urgency, importance and context switches against each other.

Candidates whose resulting task ordering is identical collapse into one, so a
strict single chain yields exactly one plan — Plina never offers fake choices.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Hashable, Iterable, List, Optional, Tuple

from django.conf import settings

from tasks.services import graph as graph_service
from tasks.services.planner_service import (
    UNBUCKETED,
    AllocationConfig,
    PlanItem,
    PlanningTask,
    allocate_tasks,
    rank_tasks,
)

#: Flow preset: half-hour minimum slices make fragmentation less attractive.
FLOW_MIN_SLICE = timedelta(minutes=30)

#: At most this many focus branches seed candidates (doc §6 Phase 1).
MAX_FOCUS_BRANCHES = 3


@dataclass(frozen=True)
class PlanWarning:
    task_id: Hashable
    header: str
    kind: str  # "deadline_missed" | "unplanned_within_horizon"
    deadline: Optional[datetime] = None
    projected_finish: Optional[datetime] = None


@dataclass(frozen=True)
class PlanMetrics:
    min_slack: Optional[timedelta]
    context_switches: int
    priority_earliness_hours: float
    project_finishes: Dict[Hashable, datetime]


@dataclass
class PlanAlternative:
    label: str
    plan: Dict[object, List[PlanItem]]
    ordering: Tuple
    metrics: PlanMetrics
    warnings: List[PlanWarning]

    @property
    def feasible(self) -> bool:
        return not self.warnings


@dataclass(frozen=True)
class _Candidate:
    """One scheduling run to attempt: a preset, optionally seeded on a branch."""
    preset: str
    focus_header: Optional[str] = None
    focus_task_ids: frozenset = frozenset()

    @property
    def label(self) -> str:
        preset_labels = {
            "deadline_safe": "Deadline-safe",
            "priority_first": "Priority-first",
            "flow": "Flow — fewer context switches",
        }
        base = preset_labels[self.preset]
        if self.focus_header:
            return f"Start with “{self.focus_header}” · {base}"
        return base


def _preset_ranking(snapshots: List[PlanningTask], preset: str,
                    now: datetime) -> List[PlanningTask]:
    if preset == "priority_first":
        no_deadline = datetime.max.replace(tzinfo=now.tzinfo)
        return sorted(
            snapshots,
            key=lambda s: (-s.priority, s.latest_finish_date or no_deadline),
        )
    return rank_tasks(list(snapshots), now)  # EDF, priority tie-break


def _preset_config(preset: str) -> AllocationConfig:
    if preset == "flow":
        return AllocationConfig(min_task_slice=FLOW_MIN_SLICE, project_stickiness=True)
    return AllocationConfig()


def _apply_focus(ranked: List[PlanningTask],
                 focus_task_ids: frozenset) -> List[PlanningTask]:
    """Stable partition: focus-branch tasks first, rank order preserved."""
    if not focus_task_ids:
        return ranked
    focused = [s for s in ranked if s.id in focus_task_ids]
    others = [s for s in ranked if s.id not in focus_task_ids]
    return focused + others


def _candidates(snapshots: List[PlanningTask], edges: List[Tuple],
                now: datetime) -> List[_Candidate]:
    presets = ["deadline_safe", "priority_first", "flow"]
    candidates = [_Candidate(preset=preset) for preset in presets]

    flexible = [
        s for s in snapshots
        if not (s.start_date is not None and (s.is_fixed or s.is_appointment))
    ]
    dag = graph_service.build_dag(flexible, edges)
    branch_list = graph_service.branches(dag)
    if len(branch_list) < 2:
        return candidates  # no real choice at the frontier

    def branch_weight(branch) -> float:
        return sum(dag.nodes[task_id].priority for task_id in branch.task_ids)

    top_branches = sorted(branch_list, key=branch_weight, reverse=True)
    for branch in top_branches[:MAX_FOCUS_BRANCHES]:
        candidates.append(_Candidate(
            preset="deadline_safe",
            focus_header=dag.nodes[branch.frontier_task_id].header,
            focus_task_ids=frozenset(branch.task_ids),
        ))
    return candidates


def _ordering_of(plan: Dict[object, List[PlanItem]]) -> Tuple:
    """The plan's identity for deduplication: tasks by first start time,
    appointments excluded (they are identical in every alternative)."""
    first_start: Dict[Hashable, datetime] = {}
    for key, items in plan.items():
        if key is UNBUCKETED:
            continue
        for item in items:
            task_id = item.task.id
            if task_id not in first_start or item.start_time < first_start[task_id]:
                first_start[task_id] = item.start_time
    return tuple(sorted(first_start, key=lambda task_id: first_start[task_id]))


def _evaluate(plan: Dict[object, List[PlanItem]], snapshots: List[PlanningTask],
              now: datetime) -> Tuple[PlanMetrics, List[PlanWarning]]:
    chronological = sorted(
        (item for key, items in plan.items() if key is not UNBUCKETED for item in items),
        key=lambda item: item.start_time,
    )
    context_switches = sum(
        1 for previous, current in zip(chronological, chronological[1:])
        if previous.task.id != current.task.id
    )

    allocated: Dict[Hashable, timedelta] = {}
    finish: Dict[Hashable, datetime] = {}
    for items in plan.values():
        for item in items:
            task_id = item.task.id
            allocated[task_id] = allocated.get(task_id, timedelta(0)) + item.duration
            end = item.start_time + item.duration
            if task_id not in finish or end > finish[task_id]:
                finish[task_id] = end

    warnings: List[PlanWarning] = []
    slacks: List[timedelta] = []
    priority_earliness = 0.0
    project_finishes: Dict[Hashable, datetime] = {}

    for snapshot in snapshots:
        fully_planned = allocated.get(snapshot.id, timedelta(0)) >= snapshot.remaining_duration
        projected = finish.get(snapshot.id)
        if not fully_planned:
            warnings.append(PlanWarning(
                task_id=snapshot.id, header=snapshot.header,
                kind="unplanned_within_horizon",
                deadline=snapshot.latest_finish_date, projected_finish=projected,
            ))
            continue
        if snapshot.latest_finish_date is not None:
            slack = snapshot.latest_finish_date - projected
            slacks.append(slack)
            if slack < timedelta(0):
                warnings.append(PlanWarning(
                    task_id=snapshot.id, header=snapshot.header,
                    kind="deadline_missed",
                    deadline=snapshot.latest_finish_date, projected_finish=projected,
                ))
        priority_earliness += snapshot.priority * (
            (projected - now).total_seconds() / 3600.0
        )
        if snapshot.project_id is not None:
            current = project_finishes.get(snapshot.project_id)
            if current is None or projected > current:
                project_finishes[snapshot.project_id] = projected

    metrics = PlanMetrics(
        min_slack=min(slacks) if slacks else None,
        context_switches=context_switches,
        priority_earliness_hours=priority_earliness,
        project_finishes=project_finishes,
    )
    return metrics, warnings


def _ordering_distance(a: Tuple, b: Tuple) -> int:
    """How different two plans are: differing positions in their orderings."""
    length = max(len(a), len(b))
    padded_a = a + (None,) * (length - len(a))
    padded_b = b + (None,) * (length - len(b))
    return sum(1 for x, y in zip(padded_a, padded_b) if x != y)


def _pick_diverse(pool: List[PlanAlternative], selected: List[PlanAlternative],
                  count: int) -> List[PlanAlternative]:
    """Greedily move up to ``count`` plans from ``pool`` into ``selected``,
    always taking the one most different from everything already chosen."""
    pool = list(pool)
    taken: List[PlanAlternative] = []
    while pool and len(taken) < count:
        anchors = selected + taken
        if not anchors:
            best = pool[0]
        else:
            best = max(pool, key=lambda candidate: min(
                _ordering_distance(candidate.ordering, chosen.ordering)
                for chosen in anchors
            ))
        pool.remove(best)
        taken.append(best)
    return taken


def _select(alternatives: List[PlanAlternative], cap: int) -> List[PlanAlternative]:
    """Feasible plans are preferred outright (§6 Phase 3): an infeasible plan
    only appears if fewer than ``cap`` feasible ones exist.  Within each group,
    pairwise ordering difference is maximized so choices stay meaningful."""
    if len(alternatives) <= cap:
        return alternatives

    def base_rank(alternative: PlanAlternative):
        slack = alternative.metrics.min_slack
        return -(slack.total_seconds() if slack is not None else float("inf"))

    feasible = sorted([a for a in alternatives if a.feasible], key=base_rank)
    infeasible = sorted([a for a in alternatives if not a.feasible], key=base_rank)

    selected: List[PlanAlternative] = []
    if feasible:
        selected.append(feasible.pop(0))  # safest feasible plan is always kept
    selected += _pick_diverse(feasible, selected, cap - len(selected))
    selected += _pick_diverse(infeasible, selected, cap - len(selected))
    return selected


def generate_alternatives(snapshots: List[PlanningTask], buckets: List,
                          edges: Iterable, now: datetime,
                          max_alternatives: Optional[int] = None) -> List[PlanAlternative]:
    """Produce up to ``MAX_PLAN_ALTERNATIVES`` meaningfully different, valid plans."""
    if max_alternatives is None:
        max_alternatives = settings.MAX_PLAN_ALTERNATIVES
    edge_list = [tuple(edge) for edge in edges]

    alternatives: List[PlanAlternative] = []
    seen_orderings = set()
    for candidate in _candidates(snapshots, edge_list, now):
        ranked = _apply_focus(
            _preset_ranking(snapshots, candidate.preset, now),
            candidate.focus_task_ids,
        )
        plan = allocate_tasks(buckets, ranked, edge_list,
                              config=_preset_config(candidate.preset))
        ordering = _ordering_of(plan)
        if ordering in seen_orderings:
            continue
        seen_orderings.add(ordering)
        metrics, warnings = _evaluate(plan, snapshots, now)
        alternatives.append(PlanAlternative(
            label=candidate.label, plan=plan, ordering=ordering,
            metrics=metrics, warnings=warnings,
        ))

    return _select(alternatives, max_alternatives)
