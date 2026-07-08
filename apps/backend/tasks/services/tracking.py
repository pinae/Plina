"""Time tracking and task completion (WP-6).

The lifecycle implements Plina's fluidity principle (A4/§6 fixing rules):

* ``start_tracking`` **anchors** the task (``is_fixed`` + ``start_date``), so
  every later recalculation keeps its plan entries byte-identical — starting
  work is the moment a task stops being fluid.
* ``stop_tracking`` books the elapsed time onto ``time_spent`` and triggers a
  recalculation of the accepted plan (A7).
* ``complete_task`` closes any open session, marks the task done, recalculates
  and — when the new frontier offers a real choice (≥ 2 branches) — computes
  and stores fresh alternatives for the "what next?" chooser.

All functions accept an explicit ``now`` for deterministic tests.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Tuple

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from tasks.models import Task, TaskDependency, TrackingSession
from tasks.services import graph as graph_service
from tasks.services.plan_store import recalculate_accepted_plan


class TrackingError(Exception):
    """Domain error; the API layer maps ``status`` and ``payload`` to a response."""
    status = 400

    def __init__(self, detail: str, **extra):
        super().__init__(detail)
        self.payload = {"detail": detail, **extra}


class AnotherSessionOpen(TrackingError):
    status = 409


class UnfinishedPredecessors(TrackingError):
    pass


def _unfinished_predecessors(task: Task) -> List[Task]:
    return list(
        Task.objects.filter(
            outgoing_dependencies__successor=task, completed_at=None
        )
    )


def _open_session() -> Optional[TrackingSession]:
    return TrackingSession.objects.filter(end=None).select_related("task").first()


@transaction.atomic
def start_tracking(task: Task, now: Optional[datetime] = None) -> TrackingSession:
    if now is None:
        now = timezone.now()
    if task.is_done:
        raise TrackingError("Cannot track a completed task.")

    blockers = _unfinished_predecessors(task)
    if blockers:
        raise UnfinishedPredecessors(
            "This task has unfinished predecessors.",
            predecessors=[
                {"id": str(blocker.id), "header": blocker.header}
                for blocker in blockers
            ],
        )

    open_session = _open_session()
    if open_session is not None:
        raise AnotherSessionOpen(
            f"A session for “{open_session.task.header}” is already running.",
            open_task_id=str(open_session.task_id),
        )

    # Anchor the task (A8): from now on recalculations keep its entries.
    task.is_fixed = True
    task.start_date = now
    task.save(update_fields=["is_fixed", "start_date"])
    return TrackingSession.objects.create(task=task, start=now)


@transaction.atomic
def stop_tracking(task: Task, now: Optional[datetime] = None) -> TrackingSession:
    if now is None:
        now = timezone.now()
    session = TrackingSession.objects.filter(task=task, end=None).first()
    if session is None:
        raise TrackingError("No tracking session is running for this task.")

    session.end = now
    session.save(update_fields=["end"])
    task.time_spent += session.end - session.start
    task.save(update_fields=["time_spent"])

    recalculate_accepted_plan(now=now)
    return session


def _frontier_branch_count(now: datetime) -> int:
    """Branches at the new frontier, over flexible unfinished tasks only."""
    from tasks.services.planner_service import build_planning_tasks

    snapshots = build_planning_tasks(
        Task.objects.filter(completed_at=None).prefetch_related("tags")
    )
    flexible = [
        snapshot for snapshot in snapshots
        if not (snapshot.start_date is not None
                and (snapshot.is_fixed or snapshot.is_appointment))
    ]
    edges = list(TaskDependency.objects.values_list("predecessor_id", "successor_id"))
    dag = graph_service.build_dag(flexible, edges)
    return len(graph_service.branches(dag))


@transaction.atomic
def complete_task(task: Task, now: Optional[datetime] = None) -> Tuple[Task, list, list]:
    """Mark done, book any running session, recalculate; returns
    ``(task, alternatives, buckets)`` where alternatives is non-empty only
    when the new frontier offers >= 2 branches."""
    if now is None:
        now = timezone.now()
    if task.is_done:
        raise TrackingError("This task is already completed.")

    session = TrackingSession.objects.filter(task=task, end=None).first()
    if session is not None:
        session.end = now
        session.save(update_fields=["end"])
        task.time_spent += session.end - session.start

    task.completed_at = now
    task.save(update_fields=["completed_at", "time_spent"])

    recalculate_accepted_plan(now=now)

    if _frontier_branch_count(now) < 2:
        return task, [], []

    from datetime import timedelta

    from tasks.services.alternatives import generate_alternatives
    from tasks.services.bucket_service import gather_time_buckets
    from tasks.services.plan_store import store_alternatives
    from tasks.services.planner_service import build_planning_tasks

    snapshots = build_planning_tasks(
        Task.objects.filter(completed_at=None).prefetch_related("tags")
    )
    horizon = timedelta(days=settings.PLANNING_HORIZON_DAYS)
    buckets = gather_time_buckets(now, now + horizon)
    edges = list(TaskDependency.objects.values_list("predecessor_id", "successor_id"))

    alternatives = generate_alternatives(snapshots, buckets, edges, now)
    plans = store_alternatives(alternatives, buckets)
    for alternative, plan in zip(alternatives, plans):
        alternative.plan_id = plan.id
    return task, alternatives, buckets
