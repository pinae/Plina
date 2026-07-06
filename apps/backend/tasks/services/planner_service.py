"""Scoring, ranking and allocation of tasks into time buckets.

Architecture rule (see README): all scheduling logic lives here, not in the
models.  The allocator never mutates ``Task`` instances; it works on immutable
:class:`PlanningTask` snapshots and tracks progress in local state only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Union
from uuid import UUID

from django.utils import timezone

from tasks.models import Task, TimeBucket

#: Estimate used for tasks the user has not sized yet.
DEFAULT_DURATION_ESTIMATE = timedelta(hours=1)

#: Minimum quantum: never start a task in a leftover gap smaller than this
#: unless the task finishes inside the gap.
MIN_TASK_SLICE = timedelta(minutes=15)

# Scoring weights: Score = WEIGHT_PRIORITY * priority + WEIGHT_DEADLINE / hours_until_deadline
WEIGHT_PRIORITY = 1.0
WEIGHT_DEADLINE = 10.0
OVERDUE_SCORE_BOOST = WEIGHT_DEADLINE * 100

#: Plan key for items that live at calendar level, outside any bucket
#: (appointments have their own time and ignore buckets entirely).
UNBUCKETED = None


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
    is_appointment: bool
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
            is_appointment=task.is_appointment,
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


@dataclass
class _Segment:
    """A still-free stretch of bucket capacity."""
    bucket_id: object
    tag_ids: frozenset
    start: datetime
    end: datetime

    @property
    def free(self) -> timedelta:
        return self.end - self.start


class _AllocationRun:
    """All mutable bookkeeping for one allocation: remaining durations,
    dependency states and finish times.  Snapshots and models stay untouched."""

    def __init__(self, snapshots: List[PlanningTask], edges: Iterable):
        self.snapshots = snapshots
        self.remaining: Dict[UUID, timedelta] = {
            snapshot.id: snapshot.remaining_duration for snapshot in snapshots
        }
        known_ids = set(self.remaining)
        self.predecessors: Dict[UUID, List[UUID]] = {}
        for predecessor, successor in edges:
            if predecessor in known_ids and successor in known_ids:
                self.predecessors.setdefault(successor, []).append(predecessor)
        self.finished_at: Dict[UUID, datetime] = {}
        self.last_task: PlanningTask | None = None

    def is_eligible(self, snapshot: PlanningTask, at: datetime) -> bool:
        """Finish-to-start: every planned predecessor must be fully allocated
        no later than ``at``.  Predecessors outside the planning set (completed
        or unknown tasks) are already satisfied."""
        return all(
            predecessor in self.finished_at and self.finished_at[predecessor] <= at
            for predecessor in self.predecessors.get(snapshot.id, [])
        )

    def consume(self, snapshot: PlanningTask, amount: timedelta, end_time: datetime) -> None:
        self.remaining[snapshot.id] -= amount
        if self.remaining[snapshot.id] <= timedelta(0):
            self.finished_at[snapshot.id] = end_time


def _matches_affinity(snapshot: PlanningTask, bucket_tag_ids: frozenset) -> bool:
    if not bucket_tag_ids:
        return True
    return bool(bucket_tag_ids & snapshot.tag_ids)


def _split_role(snapshot: PlanningTask) -> str:
    if snapshot.is_appointment and snapshot.start_date is not None:
        return "appointment"
    if snapshot.is_fixed and snapshot.start_date is not None:
        return "anchored"
    return "flexible"


def _build_segments(buckets: List, appointments: List[PlanningTask]) -> List[_Segment]:
    """Chronological free capacity: bucket time minus appointment overlaps."""
    blocked = [
        (appointment.start_date,
         appointment.start_date + appointment.remaining_duration)
        for appointment in appointments
    ]
    segments: List[_Segment] = []
    for bucket in sorted(buckets, key=lambda b: b.start_date):
        tag_ids = frozenset(tag.id for tag in bucket.type.tags.all())
        free = [(bucket.start_date, bucket.end_date)]
        for block_start, block_end in blocked:
            free = [
                part
                for start, end in free
                for part in ((start, min(end, block_start)), (max(start, block_end), end))
                if part[0] < part[1]
            ]
        segments.extend(
            _Segment(bucket_id=bucket.id, tag_ids=tag_ids, start=start, end=end)
            for start, end in free
        )
    return segments


def _place_anchored(anchored: List[PlanningTask], segments: List[_Segment],
                    run: _AllocationRun, plan: Dict[object, List[PlanItem]]) -> None:
    """Anchored fixed tasks fill capacity from their start_date onward,
    splitting across segments and buckets until their duration is placed.

    ``segments`` stays sorted by start; consumed parts are cut out in place
    so flexible allocation later only sees genuinely free capacity."""
    for snapshot in sorted(anchored, key=lambda s: s.start_date):
        cursor = snapshot.start_date
        while run.remaining[snapshot.id] > timedelta(0):
            index = next(
                (i for i, segment in enumerate(segments) if segment.end > cursor),
                None,
            )
            if index is None:
                break  # no capacity left in the horizon; leftover stays unplanned
            segment = segments[index]
            begin = max(segment.start, cursor)
            slice_duration = min(run.remaining[snapshot.id], segment.end - begin)
            end_time = begin + slice_duration
            plan.setdefault(segment.bucket_id, []).append(
                PlanItem(snapshot.source, begin, slice_duration)
            )
            run.consume(snapshot, slice_duration, end_time)
            head = _Segment(segment.bucket_id, segment.tag_ids, segment.start, begin)
            tail = _Segment(segment.bucket_id, segment.tag_ids, end_time, segment.end)
            segments[index:index + 1] = [
                part for part in (head, tail) if part.free > timedelta(0)
            ]
            cursor = end_time


def _pick_next(queue: List[PlanningTask], run: _AllocationRun,
               segment: _Segment, at: datetime) -> PlanningTask | None:
    """First candidate in ranked order; the previously worked-on task wins
    ties to avoid context switches (stickiness)."""
    free = segment.end - at

    def is_candidate(snapshot: PlanningTask) -> bool:
        needed = run.remaining[snapshot.id]
        if needed <= timedelta(0):
            return False
        if not _matches_affinity(snapshot, segment.tag_ids):
            return False
        if free < MIN_TASK_SLICE and needed > free:
            return False  # leftover gap too small to be worth a context switch
        return run.is_eligible(snapshot, at)

    if run.last_task is not None and run.last_task in queue and is_candidate(run.last_task):
        return run.last_task
    for snapshot in queue:
        if is_candidate(snapshot):
            return snapshot
    return None


def allocate_tasks(buckets: List, tasks: List[Union[Task, PlanningTask]],
                   edges: Iterable = ()) -> Dict[object, List[PlanItem]]:
    """Pack ranked tasks into buckets, honoring dependencies and pre-placements.

    * Appointments (``is_appointment`` + ``start_date``) occupy exactly their
      slot, ignore buckets, and carve capacity out of overlapping buckets;
      their items are returned under the :data:`UNBUCKETED` key.
    * Anchored fixed tasks (``is_fixed`` + ``start_date``) fill capacity from
      their start onward, splitting across buckets if needed.
    * Flexible tasks are packed greedily in ranked order with tag affinity,
      stickiness, a minimum quantum, and finish-to-start dependency
      eligibility (``edges`` as ``(predecessor_id, successor_id)`` pairs).

    Input model instances are snapshotted and never modified.
    """
    snapshots = [
        task if isinstance(task, PlanningTask) else PlanningTask.from_task(task)
        for task in tasks
        if isinstance(task, PlanningTask) or not task.is_done
    ]
    snapshots = [s for s in snapshots if s.remaining_duration > timedelta(0)]

    by_role: Dict[str, List[PlanningTask]] = {"appointment": [], "anchored": [], "flexible": []}
    for snapshot in snapshots:
        by_role[_split_role(snapshot)].append(snapshot)

    run = _AllocationRun(snapshots, edges)
    plan: Dict[object, List[PlanItem]] = {UNBUCKETED: []}
    for bucket in buckets:
        plan[bucket.id] = []

    for appointment in sorted(by_role["appointment"], key=lambda s: s.start_date):
        end_time = appointment.start_date + appointment.remaining_duration
        plan[UNBUCKETED].append(
            PlanItem(appointment.source, appointment.start_date,
                     appointment.remaining_duration)
        )
        run.consume(appointment, appointment.remaining_duration, end_time)

    segments = _build_segments(buckets, by_role["appointment"])
    _place_anchored(by_role["anchored"], segments, run, plan)

    queue = list(by_role["flexible"])  # ranked order is preserved
    for segment in segments:
        current_time = segment.start
        while current_time < segment.end:
            snapshot = _pick_next(queue, run, segment, current_time)
            if snapshot is None:
                break
            slice_duration = min(run.remaining[snapshot.id], segment.end - current_time)
            end_time = current_time + slice_duration
            plan[segment.bucket_id].append(
                PlanItem(snapshot.source, current_time, slice_duration)
            )
            run.consume(snapshot, slice_duration, end_time)
            run.last_task = snapshot
            if run.remaining[snapshot.id] <= timedelta(0):
                queue.remove(snapshot)
            current_time = end_time

    return plan
