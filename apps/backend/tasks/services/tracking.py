"""Time tracking and task completion (WP-6).

The lifecycle implements Plina's fluidity principle (A4/§6 fixing rules):

* ``start_tracking`` **anchors** the task (``is_fixed`` + ``start_date``):
  starting work is the moment a task stops being fluid, and a re-plan keeps
  it where it is worked on. A session running for another task is closed and
  booked first (UI-3), and the task's project becomes the active project.
* ``stop_tracking`` books the elapsed time onto ``time_spent``.
* ``complete_task`` closes any open session and marks the task done.

None of them re-plans (README: Planning light): the browser fits what
happened into the accepted plan until the user asks for a re-plan.

All functions accept an explicit ``now`` for deterministic tests.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Tuple

from django.db import transaction
from django.utils import timezone

from tasks.models import Task, TrackingSession


class TrackingError(Exception):
    """Domain error; the API layer maps ``status`` and ``payload`` to a response."""
    status = 400

    def __init__(self, detail: str, **extra):
        super().__init__(detail)
        self.payload = {"detail": detail, **extra}


class UnfinishedPredecessors(TrackingError):
    pass


def _unfinished_predecessors(task: Task) -> List[Task]:
    """Open predecessors of the task or of any of its ancestors (a parent's
    predecessors apply to its whole subtree)."""
    from tasks.services.tree import TreeIndex
    ancestors = TreeIndex.load().ancestor_ids(task.id)
    return list(
        Task.objects.filter(
            outgoing_dependencies__successor_id__in=[task.id, *ancestors], completed_at=None
        ).distinct()
    )


def _open_session() -> Optional[TrackingSession]:
    return TrackingSession.objects.filter(end=None).select_related("task").first()


@transaction.atomic
def start_tracking(task: Task, now: Optional[datetime] = None
                   ) -> Tuple[TrackingSession, Optional[Task]]:
    """Start working on ``task``; returns ``(session, stopped_task)``.

    A session running for another task is closed and booked first (UI-3:
    switching tasks is one click, not an error). Starting the running task
    again changes nothing. The task's project becomes the active project
    (§2); a blocked start leaves everything as it was.
    """
    from tasks.services.settings import activate, project_for_tracking
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
    if open_session is not None and open_session.task_id == task.id:
        if project_for_tracking(task) is not None:
            activate(project_for_tracking(task))
        return open_session, None
    stopped = None
    if open_session is not None:
        stopped = open_session.task
        _close(open_session, now)

    # Anchor the task (A8): from now on recalculations keep its entries.
    task.is_fixed = True
    task.start_date = now
    task.save(update_fields=["is_fixed", "start_date"])
    session = TrackingSession.objects.create(task=task, start=now)
    if project_for_tracking(task) is not None:  # a recurring task keeps the active project
        activate(project_for_tracking(task))
    return session, stopped


def _close(session: TrackingSession, now: datetime) -> None:
    session.end = now
    session.save(update_fields=["end"])
    task = session.task
    task.time_spent += session.end - session.start
    task.save(update_fields=["time_spent"])


@transaction.atomic
def stop_tracking(task: Task, now: Optional[datetime] = None) -> TrackingSession:
    if now is None:
        now = timezone.now()
    session = TrackingSession.objects.filter(task=task, end=None).first()
    if session is None:
        raise TrackingError("No tracking session is running for this task.")

    session.task = task  # book onto the caller's instance
    _close(session, now)

    return session


@transaction.atomic
def complete_task(task: Task, now: Optional[datetime] = None) -> Tuple[Task, list]:
    """Mark done, book any running session, complete finished ancestors;
    returns ``(task, auto_completed)``. The plan is not touched (README:
    Planning light)."""
    from tasks.services.completion import (CompletionError, complete_finished_ancestors,
                                           ensure_completable)
    if now is None:
        now = timezone.now()
    if task.is_done:
        raise TrackingError("This task is already completed.")
    try:
        ensure_completable(task)
    except CompletionError as error:
        raise TrackingError(str(error)) from error

    session = TrackingSession.objects.filter(task=task, end=None).first()
    if session is not None:
        session.end = now
        session.save(update_fields=["end"])
        task.time_spent += session.end - session.start

    task.completed_at = now
    task.save(update_fields=["completed_at", "time_spent"])
    from tasks.services.estimates import write_completion_snapshot
    write_completion_snapshot(task)
    auto_completed = complete_finished_ancestors(task, now)
    from tasks.services.settings import ensure_active_project_open
    ensure_active_project_open()
    return task, auto_completed
