"""Editing tracked time (README: Time sheet): correcting a session that ran
on (tracking not stopped over night) and entering time that was not
tracked live.

A session is checked like a stretch of real work: it ends after it began,
not in the future, and overlaps no other one (one task at a time). Only the
session being tracked right now may stay open; giving it an end stops it.
The task's tracked time (``time_spent``) follows every change, and a done
task's completion figures too; then the accepted plan is recalculated.

Tracking keeps seconds, the editor shows and takes whole minutes: a time
typed in whole minutes joins the session that ended (or began) within that
minute (``snap``), so the start "10:15" after a task stopped at 10:15:37
begins at 10:15:37 instead of overlapping it by 37 seconds.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Optional

from django.db import transaction
from django.utils import timezone

from tasks.models import Task, TrackingSession
from tasks.services.plan_store import recalculate_accepted_plan

#: Clocks differ a little: an end this far ahead still counts as now.
CLOCK_SLACK = timedelta(minutes=1)
MINUTE = timedelta(minutes=1)


class SessionError(Exception):
    """Why a session cannot be so, per field ("start", "end", "detail")."""

    def __init__(self, errors: Dict[str, str]):
        super().__init__(next(iter(errors.values())))
        self.errors = errors


def booked(session: TrackingSession) -> timedelta:
    """What the session added to its task's tracked time (a running one: nothing yet)."""
    return session.end - session.start if session.end is not None else timedelta(0)


def _moment(value: datetime) -> str:
    local = timezone.localtime(value)
    return f"{local:%a %d/%m %H:%M}"


def _whole_minute(value: datetime) -> bool:
    return value.second == 0 and value.microsecond == 0


def snap(start: datetime, end: Optional[datetime], session: Optional[TrackingSession] = None):
    """``start`` and ``end`` joined to their neighbours: a start typed in
    whole minutes begins when another session ended within that minute, an
    end typed so ends when another began within it (``session``: the one
    being changed, not its own neighbour)."""
    others = TrackingSession.objects.all()
    if session is not None:
        others = others.exclude(pk=session.pk)
    if _whole_minute(start):
        before = others.filter(end__gte=start, end__lt=start + MINUTE).order_by("-end").first()
        if before is not None:
            start = before.end
    if end is not None and _whole_minute(end):
        after = others.filter(start__gte=end, start__lt=end + MINUTE).order_by("start").first()
        if after is not None:
            end = after.start
    return start, end


def check(start: datetime, end: Optional[datetime], session: Optional[TrackingSession] = None,
          now: Optional[datetime] = None) -> None:
    """Refuse what cannot be (``session``: the one being changed)."""
    now = now or timezone.now()
    if start > now + CLOCK_SLACK:
        raise SessionError({"start": "This is in the future. Enter the time once it is over."})
    if end is None:
        if session is None or session.end is not None:
            raise SessionError({"end": "When did it end? Only the time being tracked right now runs on."})
    else:
        if end <= start:
            raise SessionError({"end": "The end is not after the start."})
        if end > now + CLOCK_SLACK:
            raise SessionError({"end": "This is in the future. Enter the time once it is over."})
    until = end or now
    others = TrackingSession.objects.filter(start__lt=until).select_related("task").order_by("start")
    if session is not None:
        others = others.exclude(pk=session.pk)
    for other in others:
        if (other.end or now) > start:
            other_end = "now" if other.end is None else _moment(other.end)
            raise SessionError({"detail": f"This overlaps “{other.task.header}” "
                                          f"({_moment(other.start)} – {other_end}): one task at a time."})


def _book(task: Task, change: timedelta) -> None:
    """Add ``change`` to the task's tracked time; a done task's figures follow."""
    from tasks.services.tree import TreeIndex
    task.refresh_from_db(fields=["time_spent", "completed_at"])
    task.time_spent = max(timedelta(0), task.time_spent + change)
    task.save(update_fields=["time_spent"])
    index = TreeIndex.load()
    done = Task.objects.filter(pk__in=[task.id, *index.ancestor_ids(task.id)]).exclude(completed_at=None)
    for finished in done:
        if finished.id == task.id:
            finished.completion_time_spent = finished.time_spent
        finished.completion_subtree_time_spent = index.subtree_time_spent(finished.id)
        finished.save(update_fields=["completion_time_spent", "completion_subtree_time_spent"])


@transaction.atomic
def add_session(task: Task, start: datetime, end: Optional[datetime],
                now: Optional[datetime] = None) -> TrackingSession:
    start, end = snap(start, end)
    check(start, end, now=now)
    session = TrackingSession.objects.create(task=task, start=start, end=end)
    _book(task, booked(session))
    recalculate_accepted_plan(now=now)
    return session


@transaction.atomic
def change_session(session: TrackingSession, start: datetime, end: Optional[datetime],
                   now: Optional[datetime] = None) -> TrackingSession:
    start, end = snap(start, end, session)
    check(start, end, session, now=now)
    before = booked(session)
    session.start, session.end = start, end
    session.save(update_fields=["start", "end"])
    _book(session.task, booked(session) - before)
    recalculate_accepted_plan(now=now)
    return session


@transaction.atomic
def remove_session(session: TrackingSession, now: Optional[datetime] = None) -> None:
    task, before = session.task, booked(session)
    session.delete()
    _book(task, -before)
    recalculate_accepted_plan(now=now)

