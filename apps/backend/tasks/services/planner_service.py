"""Scoring, ranking and allocation of tasks into time buckets.

Architecture rule (see README): all scheduling logic lives here, not in the
models.  The allocator never mutates ``Task`` instances; it works on immutable
:class:`PlanningTask` snapshots and tracks progress in local state only.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple, Union
from uuid import UUID

from django.utils import timezone

from tasks.models import Task, TimeBucket
from tasks.services.tree import DEFAULT_DURATION, TreeIndex, expand_edges

#: Estimate used for tasks the user has not sized yet.
DEFAULT_DURATION_ESTIMATE = DEFAULT_DURATION

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
    is_appointment: bool
    start_date: datetime | None
    remaining_duration: timedelta
    project_id: UUID | None
    source: Task = field(compare=False, repr=False)
    #: The unit is a parent's Rest (planned under the parent's id, UI-2).
    is_rest: bool = False
    #: Not planned before this: a recurring task's occurrence that is still
    #: ahead (README: Recurring tasks).
    not_before: datetime | None = None

    @classmethod
    def from_task(cls, task: Task, project_id: UUID | None | object = ...,
                  deadline: datetime | None | object = ...,
                  default_duration: timedelta = DEFAULT_DURATION_ESTIMATE) -> "PlanningTask":
        """``project_id`` is the top-level ancestor (None for a top-level
        task); looked up through the parent chain unless given. ``deadline``
        defaults to the task's own deadline (callers pass the effective one)."""
        estimated = task.duration if task.duration is not None else default_duration
        remaining = max(estimated - task.time_spent, timedelta(0))
        if project_id is ...:
            root = task.parent
            while root is not None and root.parent_id is not None:
                root = root.parent
            project_id = root.id if root is not None else None
        return cls(
            id=task.id,
            header=task.header,
            priority=task.priority,
            latest_finish_date=task.latest_finish_date if deadline is ... else deadline,
            tag_ids=frozenset(tag.id for tag in task.tags.all()),
            is_fixed=task.is_fixed,
            is_appointment=task.is_appointment,
            start_date=task.start_date,
            remaining_duration=remaining,
            project_id=project_id,
            source=task,
            not_before=task.occurrence if task.series_id is not None and not task.is_appointment else None,
        )

    @classmethod
    def rest_of(cls, parent: Task, rest: timedelta, project_id: UUID,
                deadline: datetime | None) -> "PlanningTask":
        """The not-yet-split remainder of a parent's estimate (§4.5)."""
        return cls(
            id=parent.id,
            header=f"Rest of {parent.header}",
            priority=parent.priority,
            latest_finish_date=deadline,
            tag_ids=frozenset(tag.id for tag in parent.tags.all()),
            is_fixed=parent.is_fixed,
            is_appointment=False,
            start_date=parent.start_date,
            remaining_duration=rest,
            project_id=project_id,
            source=parent,
            is_rest=True,
        )


def build_planning_tasks(tasks: Iterable[Task]) -> List[PlanningTask]:
    """Snapshot all tasks that still need planning.

    Units are the open leaves plus, for every open parent with a positive
    Rest, one Rest unit under the parent's id (UI-2). Leaves and Rests carry
    the effective (earliest ancestor) deadline. Completed tasks and units
    without remaining work are excluded.
    """
    tree = TreeIndex.load()
    snapshots = []
    for task in tasks:
        if task.is_done:
            continue
        if task.id not in tree.nodes:  # unsaved instance (tests)
            snapshots.append(PlanningTask.from_task(task, project_id=None,
                                                    default_duration=tree.default_duration))
            continue
        deadline = tree.effective_deadline(task.id)
        root = tree.root_id(task.id)
        if tree.has_children(task.id):
            rest = tree.rest(task.id)
            if rest:
                snapshots.append(PlanningTask.rest_of(task, rest, root or task.id, deadline))
        else:
            snapshots.append(PlanningTask.from_task(task, project_id=root, deadline=deadline,
                                                    default_duration=tree.default_duration))
    return [snapshot for snapshot in snapshots if snapshot.remaining_duration > timedelta(0)]


def planning_edges(snapshots: Iterable[PlanningTask]) -> List[tuple]:
    """Dependencies expanded onto the planning units (see
    :func:`tasks.services.tree.expand_edges`)."""
    from tasks.models import TaskDependency
    raw = TaskDependency.objects.values_list("predecessor_id", "successor_id")
    return expand_edges(raw, TreeIndex.load(), {snapshot.id for snapshot in snapshots})


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

    def __init__(self, task: Task, start_time: datetime, duration: timedelta,
                 is_rest: bool = False, deadline: datetime | None | object = ...):
        self.task = task
        self.start_time = start_time
        self.duration = duration
        #: A parent's Rest placeholder (``task`` is the parent).
        self.is_rest = is_rest
        self.warnings: List[str] = []
        deadline = task.latest_finish_date if deadline is ... else deadline
        if deadline and start_time + duration > deadline:
            self.warnings.append("Deadline exceeded")

    @classmethod
    def of(cls, snapshot: "PlanningTask", start_time: datetime, duration: timedelta) -> "PlanItem":
        return cls(snapshot.source, start_time, duration, is_rest=snapshot.is_rest,
                   deadline=snapshot.latest_finish_date)

    @property
    def header(self) -> str:
        return f"Rest of {self.task.header}" if self.is_rest else self.task.header

    def __repr__(self) -> str:
        return f"<PlanItem: {self.task.header} at {self.start_time}>"


#: Plan key for items that live at calendar level, outside any bucket
#: (appointments have their own time and ignore buckets entirely).
UNBUCKETED = None


@dataclass(frozen=True)
class AllocationConfig:
    """Tunable allocation behavior; presets (WP-4) vary these knobs.

    ``min_task_slice``: minimum quantum for starting a task in a leftover gap.
    ``project_stickiness``: after finishing a task, prefer tasks of the same
    project before switching, on top of regular task stickiness.
    ``focus_task_ids``: the branch a focus alternative starts with; its tasks
    win over stickiness to a task outside it.
    """
    min_task_slice: timedelta = MIN_TASK_SLICE
    project_stickiness: bool = False
    focus_task_ids: frozenset = frozenset()


DEFAULT_CONFIG = AllocationConfig()


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


class _Occupied:
    """The time already planned, over all buckets: where two buckets cover
    the same hours (two kinds of time that overlap), that time is planned
    once — what one bucket's task took, the other's cannot have too."""

    def __init__(self):
        self._spans: List[Tuple[datetime, datetime]] = []  # sorted, merged, not touching

    def add(self, start: datetime, end: datetime) -> None:
        spans = [span for span in self._spans if span[1] < start or span[0] > end]
        joined = [span for span in self._spans if not (span[1] < start or span[0] > end)]
        start = min([start, *(span[0] for span in joined)])
        end = max([end, *(span[1] for span in joined)])
        spans.append((start, end))
        self._spans = sorted(spans)

    def free_window(self, at: datetime, limit: datetime) -> Optional[Tuple[datetime, datetime]]:
        """The first free stretch from ``at`` on, before ``limit``; None if
        there is none."""
        index = bisect_right(self._spans, (at, datetime.max.replace(tzinfo=at.tzinfo))) - 1
        if index >= 0 and self._spans[index][1] > at:
            at = self._spans[index][1]  # inside planned time: free from its end
        if at >= limit:
            return None
        following = bisect_right(self._spans, (at, datetime.max.replace(tzinfo=at.tzinfo)))
        until = self._spans[following][0] if following < len(self._spans) else limit
        return at, min(until, limit)


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
    """Untagged buckets take every task; untagged tasks go into every bucket
    (as if they had all tags — the user just did not sort them yet)."""
    if not bucket_tag_ids or not snapshot.tag_ids:
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
                    run: _AllocationRun, plan: Dict[object, List[PlanItem]],
                    occupied: _Occupied) -> None:
    """Anchored fixed tasks fill capacity from their start_date onward,
    splitting across segments and buckets until their duration is placed.

    ``segments`` stays sorted by start; consumed parts are cut out in place
    so flexible allocation later only sees genuinely free capacity."""
    for snapshot in sorted(anchored, key=lambda s: s.start_date):
        cursor = snapshot.start_date
        while run.remaining[snapshot.id] > timedelta(0):
            # Only spill into buckets whose affinity accepts the task — a split
            # task must not fill unsuitable time buckets just because they are
            # chronologically next.
            index = next(
                (
                    i for i, segment in enumerate(segments)
                    if segment.end > cursor
                    and _matches_affinity(snapshot, segment.tag_ids)
                ),
                None,
            )
            if index is None:
                break  # no suitable capacity left in the horizon; leftover unplanned
            segment = segments[index]
            window = occupied.free_window(max(segment.start, cursor), segment.end)
            if window is None:
                cursor = segment.end  # taken in an overlapping bucket
                continue
            begin, window_end = window
            slice_duration = min(run.remaining[snapshot.id], window_end - begin)
            end_time = begin + slice_duration
            plan.setdefault(segment.bucket_id, []).append(
                PlanItem.of(snapshot, begin, slice_duration)
            )
            run.consume(snapshot, slice_duration, end_time)
            occupied.add(begin, end_time)
            head = _Segment(segment.bucket_id, segment.tag_ids, segment.start, begin)
            tail = _Segment(segment.bucket_id, segment.tag_ids, end_time, segment.end)
            segments[index:index + 1] = [
                part for part in (head, tail) if part.free > timedelta(0)
            ]
            cursor = end_time


def _pick_next(queue: List[PlanningTask], run: _AllocationRun,
               segment: _Segment, at: datetime,
               config: AllocationConfig) -> PlanningTask | None:
    """First candidate in ranked order; the previously worked-on task wins
    ties to avoid context switches (stickiness).  With project stickiness,
    same-project candidates win before other projects get a turn.  With a
    focus branch, its tasks win before stickiness to any other task: one that
    only filled time the branch could not use (a bucket of another tag) must
    not keep the next bucket and push the branch back."""
    free = segment.end - at

    def is_candidate(snapshot: PlanningTask) -> bool:
        needed = run.remaining[snapshot.id]
        if needed <= timedelta(0):
            return False
        if not _matches_affinity(snapshot, segment.tag_ids):
            return False
        if free < config.min_task_slice and needed > free:
            return False  # leftover gap too small to be worth a context switch
        if snapshot.not_before is not None and at < snapshot.not_before:
            return False
        return run.is_eligible(snapshot, at)

    last = run.last_task
    if config.focus_task_ids and (last is None or last.id not in config.focus_task_ids):
        for snapshot in queue:
            if snapshot.id in config.focus_task_ids and is_candidate(snapshot):
                return snapshot
    if last is not None and last in queue and is_candidate(last):
        return last
    if config.project_stickiness and last is not None and last.project_id is not None:
        for snapshot in queue:
            if snapshot.project_id == last.project_id and is_candidate(snapshot):
                return snapshot
    for snapshot in queue:
        if is_candidate(snapshot):
            return snapshot
    return None


def allocate_tasks(buckets: List, tasks: List[Union[Task, PlanningTask]],
                   edges: Iterable = (),
                   config: AllocationConfig = DEFAULT_CONFIG) -> Dict[object, List[PlanItem]]:
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
    occupied = _Occupied()
    _place_anchored(by_role["anchored"], segments, run, plan, occupied)

    queue = list(by_role["flexible"])  # ranked order is preserved
    for segment in segments:
        current_time = segment.start
        while current_time < segment.end:
            # Only time no other bucket's task took (buckets may overlap).
            window = occupied.free_window(current_time, segment.end)
            if window is None:
                break
            current_time, window_end = window
            free = _Segment(segment.bucket_id, segment.tag_ids, current_time, window_end)
            snapshot = _pick_next(queue, run, free, current_time, config)
            if snapshot is None:
                # Nothing fits now; a recurring task may become due later in the bucket.
                due = [s.not_before for s in queue if s.not_before and current_time < s.not_before < window_end]
                if due:
                    current_time = min(due)
                elif window_end < segment.end:
                    current_time = window_end  # the next free stretch of this bucket
                else:
                    break
                continue
            slice_duration = min(run.remaining[snapshot.id], window_end - current_time)
            end_time = current_time + slice_duration
            plan[segment.bucket_id].append(
                PlanItem.of(snapshot, current_time, slice_duration)
            )
            run.consume(snapshot, slice_duration, end_time)
            occupied.add(current_time, end_time)
            run.last_task = snapshot
            if run.remaining[snapshot.id] <= timedelta(0):
                queue.remove(snapshot)
            current_time = end_time

    return plan
