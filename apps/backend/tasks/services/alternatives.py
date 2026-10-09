"""Generation of alternative plans (WP-4, docs/plan-chooser.md).

A dependency DAG usually admits many valid topological orderings.  Instead of
enumerating them, this module finds the *meaningful* choices — what to do
next:

* A task being tracked comes first in every plan; the choice is what follows.
* Without one, the options start with different **projects**: the one with
  the highest priority and the ones worked on most recently, then the others
  by priority.
* Three **presets** (deadline-safe / priority-first / flow) trade urgency,
  importance and context switches against each other. Flow stays in the
  running (or first) task's project; deadline-safe follows priority as far as
  it can without missing more deadlines than earliest-deadline-first.

Candidates whose resulting task ordering is identical collapse into one, so a
strict single chain yields exactly one plan — Plina never offers fake choices.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Hashable, Iterable, List, Optional, Tuple

from django.conf import settings

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

#: Recently worked on: tracked within this long, at most this many projects.
RECENT_WINDOW = timedelta(days=14)
MAX_RECENT_PROJECTS = 2

#: Deadline-safe: how strongly a near deadline counts against priority, from
#: "priority alone" up; the first weight that misses no more deadlines than
#: earliest-deadline-first wins, else EDF itself.
DEADLINE_WEIGHTS = (0.0, 1.0, 3.0, 10.0)


@dataclass(frozen=True)
class PlanningContext:
    """What the options are about (docs/plan-chooser.md)."""
    #: The planning unit being tracked now, and its project.
    running_id: Optional[Hashable] = None
    running_project_id: Optional[Hashable] = None
    #: Project names and priorities (top-level tasks).
    projects: Dict[Hashable, Tuple[str, float]] = field(default_factory=dict)
    #: Worked on most recently first.
    recent_project_ids: Tuple = ()


def planning_context(now: datetime) -> PlanningContext:
    """The running task, the projects and what was worked on lately."""
    from tasks.models import Task, TrackingSession
    from tasks.services.tree import TreeIndex
    tree = TreeIndex.load()
    projects = {task.id: (task.header, task.priority) for task in Task.objects.filter(parent=None)}
    running = TrackingSession.objects.filter(end=None).first()
    recent: List = []
    for session in TrackingSession.objects.filter(start__gte=now - RECENT_WINDOW).order_by("-start"):
        root = tree.root_id(session.task_id) if session.task_id in tree.nodes else None
        if root is not None and root not in recent:
            recent.append(root)
    running_project = None
    if running is not None and running.task_id in tree.nodes:
        running_project = tree.root_id(running.task_id)
    return PlanningContext(
        running_id=running.task_id if running is not None else None,
        running_project_id=running_project,
        projects=projects,
        recent_project_ids=tuple(recent),
    )


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
    #: Generation parameters, persisted with the plan (WP-5) so recalculation
    #: can rebuild the same ranking after tasks change.
    preset: str = "deadline_safe"
    focus_task_ids: frozenset = frozenset()
    #: What the option is about: deadline_safe | priority_first | flow |
    #: top_project | recent_project | project — and its project, if any.
    kind: str = "deadline_safe"
    project_id: Optional[Hashable] = None
    project_name: Optional[str] = None
    #: The project of what is done next (after a running task): options
    #: should differ in it.
    next_project_id: Optional[Hashable] = None

    @property
    def feasible(self) -> bool:
        return not self.warnings


@dataclass(frozen=True)
class _Candidate:
    """One scheduling run to attempt: a preset, optionally focused on a project."""
    preset: str
    kind: str
    label: str
    focus_task_ids: frozenset = frozenset()
    project_id: Optional[Hashable] = None
    project_name: Optional[str] = None


def _priority_ranking(snapshots: List[PlanningTask], now: datetime,
                      deadline_weight: float) -> List[PlanningTask]:
    """By priority, a near deadline adding ``deadline_weight`` per day it is
    closer than a day (overdue: the most)."""
    no_deadline = datetime.max.replace(tzinfo=now.tzinfo)

    def urgency(snapshot: PlanningTask) -> float:
        if snapshot.latest_finish_date is None:
            return 0.0
        days = (snapshot.latest_finish_date - now).total_seconds() / 86400
        return 1 / max(days, 0.1)

    return sorted(snapshots, key=lambda s: (
        -(s.priority + deadline_weight * urgency(s)), s.latest_finish_date or no_deadline))


def _preset_ranking(snapshots: List[PlanningTask], preset: str,
                    now: datetime, deadline_weight: Optional[float] = None) -> List[PlanningTask]:
    if preset == "priority_first":
        return _priority_ranking(snapshots, now, 0.0)
    if preset == "deadline_safe" and deadline_weight is not None:
        return _priority_ranking(snapshots, now, deadline_weight)
    return rank_tasks(list(snapshots), now)  # EDF, priority tie-break


def _lateness(plan, snapshots: List[PlanningTask], now: datetime) -> Tuple[int, timedelta]:
    """Deadlines missed and by how much at most."""
    _, warnings = _evaluate(plan, snapshots, now)
    late = [w.projected_finish - w.deadline for w in warnings
            if w.kind == "deadline_missed" and w.projected_finish and w.deadline]
    unplanned = sum(1 for w in warnings if w.kind == "unplanned_within_horizon" and w.deadline)
    return len(late) + unplanned, max(late, default=timedelta(0))


def deadline_weight(snapshots: List[PlanningTask], buckets: List, edges: List[Tuple],
                    now: datetime, running_id=None) -> Optional[float]:
    """The smallest deadline weight whose plan misses no more deadlines (nor
    by more) than earliest-deadline-first; None: EDF it is."""
    def outcome(ranked):
        return _lateness(allocate_tasks(buckets, ranked, edges, running_id=running_id, now=now), snapshots, now)

    edf_missed, edf_late = outcome(rank_tasks(list(snapshots), now))
    for weight in DEADLINE_WEIGHTS:
        missed, late = outcome(_priority_ranking(snapshots, now, weight))
        if missed <= edf_missed and late <= edf_late:
            return weight
    return None


def plan_ranking(snapshots: List[PlanningTask], preset: str, focus_task_ids: frozenset,
                 now: datetime, context: PlanningContext,
                 weight: Optional[float]) -> List[PlanningTask]:
    """The ranking a candidate (or a re-plan of it) allocates in."""
    ranked = _preset_ranking(snapshots, preset, now, weight)
    if preset == "flow" and not focus_task_ids:
        # Stay in the running task's project before switching.
        project = context.running_project_id
        focus_task_ids = frozenset(s.id for s in snapshots if project is not None and s.project_id == project)
    return _apply_focus(ranked, focus_task_ids)


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


def _candidates(snapshots: List[PlanningTask], context: PlanningContext) -> List[_Candidate]:
    """Projects first (what to do next), then the presets."""
    by_project: Dict[Hashable, List[PlanningTask]] = {}
    for snapshot in snapshots:
        if snapshot.project_id is not None:
            by_project.setdefault(snapshot.project_id, []).append(snapshot)
    projects = [p for p in context.projects if p in by_project and p != context.running_project_id]
    name = lambda project_id: context.projects[project_id][0]  # noqa: E731
    by_priority = sorted(projects, key=lambda p: (-context.projects[p][1], name(p)))
    recent = [p for p in context.recent_project_ids if p in projects][:MAX_RECENT_PROJECTS]

    chosen: List[Tuple[str, Hashable]] = []
    if by_priority:
        chosen.append(("top_project", by_priority[0]))
    chosen += [("recent_project", p) for p in recent if p != by_priority[0]]
    chosen += [("project", p) for p in by_priority if all(p != c for _, c in chosen)]
    labels = ({"top_project": "Then {} (highest priority)", "recent_project": "Then back to {}",
               "project": "Then {}"} if context.running_id is not None
              else {"top_project": "Highest priority: {}", "recent_project": "Continue {}", "project": "Next: {}"})
    candidates = [
        _Candidate(preset="deadline_safe", kind=kind, label=labels[kind].format(name(project)),
                   focus_task_ids=frozenset(s.id for s in by_project[project]),
                   project_id=project, project_name=name(project))
        for kind, project in chosen
    ]

    running = context.running_project_id
    flow_label = (f"Stay in {context.projects[running][0]}" if running in context.projects
                  else "Flow — fewer context switches")
    presets = [
        _Candidate(preset="deadline_safe", kind="deadline_safe", label="Deadline-safe"),
        _Candidate(preset="flow", kind="flow", label=flow_label,
                   project_id=running if running in context.projects else None,
                   project_name=context.projects[running][0] if running in context.projects else None),
        _Candidate(preset="priority_first", kind="priority_first", label="Priority-first"),
    ]
    # Where two options plan the same, the earlier name stays: projects say
    # more than presets. Running: staying (flow) is the first option.
    if context.running_id is not None:
        return [presets[1], *candidates, presets[0], presets[2]]
    return candidates + presets


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
    """In candidate order, options whose next task is in a project not yet
    offered come first; the other slots go to feasible plans before
    infeasible ones (§6 Phase 3), the most different first."""
    if len(alternatives) <= cap:
        return alternatives
    selected: List[PlanAlternative] = []
    projects_offered = set()
    for alternative in alternatives:
        if len(selected) < cap and alternative.next_project_id not in projects_offered:
            selected.append(alternative)
            projects_offered.add(alternative.next_project_id)
    rest = [a for a in alternatives if a not in selected]
    selected += _pick_diverse([a for a in rest if a.feasible], selected, cap - len(selected))
    selected += _pick_diverse([a for a in rest if not a.feasible], selected, cap - len(selected))
    return selected


def _next_project(plan: Dict[object, List[PlanItem]], snapshots: List[PlanningTask],
                  running_id) -> Optional[Hashable]:
    """The project of the first planned task after the running one."""
    project_of = {snapshot.id: snapshot.project_id for snapshot in snapshots}
    items = sorted((item for key, items in plan.items() if key is not UNBUCKETED for item in items),
                   key=lambda item: item.start_time)
    for item in items:
        if item.task.id != running_id:
            return project_of.get(item.task.id, item.task.id)
    return None


def generate_alternatives(snapshots: List[PlanningTask], buckets: List,
                          edges: Iterable, now: datetime,
                          max_alternatives: Optional[int] = None,
                          context: Optional[PlanningContext] = None) -> List[PlanAlternative]:
    """Produce up to ``MAX_PLAN_ALTERNATIVES`` meaningfully different, valid plans."""
    if max_alternatives is None:
        max_alternatives = settings.MAX_PLAN_ALTERNATIVES
    if context is None:
        context = planning_context(now)
    edge_list = [tuple(edge) for edge in edges]
    running_id = context.running_id
    weight = deadline_weight(snapshots, buckets, edge_list, now, running_id)

    alternatives: List[PlanAlternative] = []
    seen_orderings = set()
    for candidate in _candidates(snapshots, context):
        ranked = plan_ranking(snapshots, candidate.preset, candidate.focus_task_ids, now, context, weight)
        plan = allocate_tasks(buckets, ranked, edge_list, config=_preset_config(candidate.preset),
                              running_id=running_id, now=now)
        ordering = _ordering_of(plan)
        if ordering in seen_orderings:
            continue
        seen_orderings.add(ordering)
        metrics, warnings = _evaluate(plan, snapshots, now)
        alternatives.append(PlanAlternative(
            label=candidate.label, plan=plan, ordering=ordering,
            metrics=metrics, warnings=warnings,
            preset=candidate.preset, focus_task_ids=candidate.focus_task_ids,
            kind=candidate.kind, project_id=candidate.project_id, project_name=candidate.project_name,
            next_project_id=_next_project(plan, snapshots, running_id),
        ))

    return _select(alternatives, max_alternatives)
