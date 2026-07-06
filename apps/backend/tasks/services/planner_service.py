"""Scoring, ranking and allocation of tasks into time buckets.

Architecture rule (see README): all scheduling logic lives here, not in the
models.  The allocator never mutates ``Task`` instances; it works on immutable
:class:`PlanningTask` snapshots and tracks progress in local state only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Union, Set
from uuid import UUID

from django.utils import timezone

from tasks.models import Task, TimeBucket
from tasks.services.graph import DependencyGraph

#: Estimate used for tasks the user has not sized yet.
DEFAULT_DURATION_ESTIMATE = timedelta(hours=1)

#: Minimum quantum: never start a task in a leftover gap smaller than this
#: unless the task finishes inside the gap.
MIN_TASK_SLICE = timedelta(minutes=15)

# Scoring weights: Score = WEIGHT_PRIORITY * priority + WEIGHT_DEADLINE / hours_until_deadline
WEIGHT_PRIORITY = 1.0
WEIGHT_DEADLINE = 10.0
OVERDUE_SCORE_BOOST = WEIGHT_DEADLINE * 100


@dataclass(frozen=True)
class PlanningTask:
    """Immutable snapshot of a :class:`~tasks.models.Task` for one planning run.

    Snapshotting up front keeps the allocation loop free of database queries
    and guarantees the planner cannot accidentally write partial state back
    to a model instance.
    """

    id: UUID
    header: str
    priority: float
    latest_finish_date: datetime | None
    tag_ids: frozenset
    is_fixed: bool
    start_date: datetime | None
    remaining_duration: timedelta
    project_id: UUID | None
    source: Task = field(compare=False, repr=False)

    @classmethod
    def from_task(cls, task: Task) -> "PlanningTask":
        estimated = task.duration if task.duration is not None else DEFAULT_DURATION_ESTIMATE
        remaining = max(estimated - task.time_spent, timedelta(0))
        project = task.project
        return cls(
            id=task.id,
            header=task.header,
            priority=task.priority,
            latest_finish_date=task.latest_finish_date,
            tag_ids=frozenset(tag.id for tag in task.tags.all()),
            is_fixed=task.is_fixed,
            start_date=task.start_date,
            remaining_duration=remaining,
            project_id=project.id if project is not None else None,
            source=task,
        )


def build_planning_tasks(tasks: Iterable[Task]) -> List[PlanningTask]:
    """Snapshot all tasks that still need planning.

    Completed tasks and tasks without remaining work are excluded.
    """
    snapshots = (PlanningTask.from_task(task) for task in tasks if not task.is_done)
    return [snapshot for snapshot in snapshots if snapshot.remaining_duration > timedelta(0)]


def calculate_dynamic_score(task: Union[Task, PlanningTask], now: datetime) -> float:
    """Combine importance (priority) and urgency (deadline proximity)."""
    score = WEIGHT_PRIORITY * task.priority
    if task.latest_finish_date:
        hours_until = (task.latest_finish_date - now).total_seconds() / 3600.0
        if hours_until > 0:
            score += WEIGHT_DEADLINE / hours_until
        else:
            score += OVERDUE_SCORE_BOOST
    return score


def rank_tasks(tasks: List[Union[Task, PlanningTask]], now: datetime) -> List[Union[Task, PlanningTask]]:
    """Earliest Deadline First; priority breaks ties within a deadline window.

    Tasks without a deadline sort last (soft constraints only).
    """
    no_deadline_sentinel = datetime.max.replace(tzinfo=timezone.get_current_timezone())

    def sort_key(task):
        deadline = task.latest_finish_date or no_deadline_sentinel
        return deadline, -task.priority

    return sorted(tasks, key=sort_key)


class PlanItem:
    """One contiguous slice of a task placed inside a bucket."""

    def __init__(self, task: Task, start_time: datetime, duration: timedelta):
        self.task = task
        self.start_time = start_time
        self.duration = duration
        self.warnings: List[str] = []
        if task.latest_finish_date and start_time + duration > task.latest_finish_date:
            self.warnings.append("Deadline exceeded")

    def __repr__(self) -> str:
        return f"<PlanItem: {self.task.header} at {self.start_time}>"


class _AllocationState:
    """Mutable bookkeeping for a single allocation run.

    Keeps the remaining durations in a local dict so the immutable snapshots
    (and the underlying models) are never touched.
    """
    def __init__(self, snapshots: List[PlanningTask], graph: DependencyGraph):
        self.queue: List[PlanningTask] = list(snapshots)
        self.remaining: Dict[UUID, timedelta] = {
            snapshot.id: snapshot.remaining_duration for snapshot in snapshots
        }
        self.completed_at: Dict[UUID, datetime] = {}
        self.graph = graph
        self.last_task: PlanningTask | None = None

    def remaining_of(self, snapshot: PlanningTask) -> timedelta:
        return self.remaining.get(snapshot.id, timedelta(0))

    def consume(self, snapshot: PlanningTask, amount: timedelta, current_time: datetime) -> None:
        self.remaining[snapshot.id] -= amount
        if self.remaining[snapshot.id] <= timedelta(0):
            self.completed_at[snapshot.id] = current_time

    def is_eligible(self, snapshot: PlanningTask, bucket_start: datetime) -> bool:
        predecessors = self.graph.predecessors.get(snapshot.id, [])
        for pred_id in predecessors:
            if pred_id not in self.completed_at or self.completed_at[pred_id] > bucket_start:
                return False
        return True


def _matches_affinity(snapshot: PlanningTask, bucket_tag_ids: frozenset) -> bool:
    if not bucket_tag_ids:
        return True
    return bool(bucket_tag_ids & snapshot.tag_ids)


def _apply_stickiness(queue: List[PlanningTask], state: _AllocationState,
                      bucket_tag_ids: frozenset) -> List[PlanningTask]:
    last = state.last_task
    if last is None or last not in queue:
        return queue
    if not _matches_affinity(last, bucket_tag_ids):
        return queue
    reordered = [last]
    reordered.extend(task for task in queue if task is not last)
    return reordered


def allocate_tasks(buckets: List[TimeBucket],
                   tasks: List[Union[Task, PlanningTask]],
                   graph: DependencyGraph) -> Dict[object, List[PlanItem]]:
    snapshots = [
        task if isinstance(task, PlanningTask) else PlanningTask.from_task(task)
        for task in tasks
        if isinstance(task, PlanningTask) or not task.is_done
    ]
    snapshots = [s for s in snapshots if s.remaining_duration > timedelta(0)]

    plan: Dict[object, List[PlanItem]] = {bucket.id: [] for bucket in buckets}

    # 1. Pre-place appointments (start_date set, not necessarily fixed by tracking)
    appointments = [s for s in snapshots if s.start_date is not None and not s.is_fixed]
    for appt in appointments:
        plan["appointments"] = plan.get("appointments", [])
        plan["appointments"].append(PlanItem(appt.source, appt.start_date, appt.remaining_duration))
        snapshots.remove(appt)

    # 2. Setup state for fluid and fixed tasks
    state = _AllocationState(snapshots, graph)
    sorted_buckets = sorted(buckets, key=lambda b: b.start_date)

    for bucket in sorted_buckets:
        _fill_bucket(bucket, state, plan, appointments)

    return plan


def _fill_bucket(bucket: TimeBucket, state: _AllocationState, plan: Dict[object, List[PlanItem]],
                 appointments: List[PlanningTask]) -> None:
    bucket_tag_ids = frozenset(tag.id for tag in bucket.type.tags.all())

    # Pre-place Fixed Tasks (is_fixed=True) first for this bucket
    fixed_tasks = [t for t in state.queue if t.is_fixed]
    current_time = bucket.start_date

    for fixed in fixed_tasks:
        needed = state.remaining_of(fixed)
        if needed <= timedelta(0):
            continue

        free_time = bucket.end_date - current_time
        if free_time <= timedelta(0):
            continue

        slice_duration = min(needed, free_time)
        plan[bucket.id].append(PlanItem(fixed.source, current_time, slice_duration))
        current_time += slice_duration
        state.consume(fixed, slice_duration, current_time)
        state.last_task = fixed

    # Filter out fluid tasks that are not eligible yet (predecessors unfinished)
    eligible_fluid_queue = [t for t in state.queue if not t.is_fixed and state.is_eligible(t, bucket.start_date)]
    queue = _apply_stickiness(eligible_fluid_queue, state, bucket_tag_ids)

    deferred: List[PlanningTask] = [t for t in state.queue if
                                    not t.is_fixed and not state.is_eligible(t, bucket.start_date)]
    deferred.extend([t for t in state.queue if t.is_fixed and state.remaining_of(t) > timedelta(0)])

    for snapshot in queue:
        # Check against appointment overlaps within this bucket
        free_time = bucket.end_date - current_time

        # Simplified for now: subtract appointment times if they fall in this bucket.
        # In a fully rigorous interval tree, we would fragment the free_time around appointments.
        for appt in appointments:
            if appt.start_date and current_time <= appt.start_date < bucket.end_date:
                overlap = min(bucket.end_date, appt.start_date + appt.remaining_duration) - max(current_time,
                                                                                                appt.start_date)
                free_time -= overlap

        needed = state.remaining_of(snapshot)

        if not _matches_affinity(snapshot, bucket_tag_ids) or free_time <= timedelta(0):
            deferred.append(snapshot)
            continue

        if free_time < MIN_TASK_SLICE and needed > free_time:
            deferred.append(snapshot)
            continue

        slice_duration = min(needed, free_time)
        plan[bucket.id].append(PlanItem(snapshot.source, current_time, slice_duration))
        current_time += slice_duration
        state.consume(snapshot, slice_duration, current_time)
        state.last_task = snapshot

        if state.remaining_of(snapshot) > timedelta(0):
            deferred.append(snapshot)

    state.queue = deferred
