"""Recurring tasks (README: Recurring tasks): a :class:`TaskSeries` holds
the rule ("every tuesday at 20:00", services.recurrence); every occurrence
is a task of its own (``Task.series``, ``Task.occurrence``), completed and
tracked on its own.

* An appointment's occurrences exist for the planning horizon ahead, so they
  block their time like any appointment. A past one completes itself when
  it ends, unless it is being tracked.
* Any other task's next occurrence appears when its date is reached — also
  while the one before is still open — and is planned like any other task
  from then on.
* A new occurrence copies the latest one (header, description, estimate,
  priority, tags, color, project); a deadline moves along with the date.
* Deleting one occurrence skips its date; :func:`delete_series` deletes all.

Occurrences are made when tasks or plans are asked for
(:func:`spawn_occurrences`), so no scheduler is needed; the unique
(series, occurrence) constraint keeps it from making one twice.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Dict, Iterable, List, Optional, Tuple

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone

from tasks.models import Task, TaskSeries, TrackingSession
from tasks.services.estimates import record_estimate_change, write_completion_snapshot
from tasks.services.recurrence import (RecurrenceError, Rule, describe, first_occurrences, next_occurrence,
                                       occurrences, parse_rule)
from tasks.services.tree import next_sibling_order

#: What a new occurrence copies from the latest one.
COPIED_FIELDS = ["header", "description", "duration", "priority", "color", "auto_color", "is_appointment",
                 "parent_id"]


def _key(moment: datetime) -> str:
    """An occurrence as stored in ``TaskSeries.skipped``."""
    return moment.astimezone(dt_timezone.utc).isoformat()


def _day_start(moment: datetime) -> datetime:
    return timezone.localtime(moment).replace(hour=0, minute=0, second=0, microsecond=0)


def _wall_clock_shift(moment: datetime, old_base: datetime, new_base: datetime) -> datetime:
    """``moment`` moved from ``old_base`` to ``new_base`` in wall-clock time:
    a deadline two days after 20:00 stays two days after, at the same hour."""
    local = lambda value: timezone.localtime(value).replace(tzinfo=None)  # noqa: E731
    return timezone.make_aware(local(new_base) + (local(moment) - local(old_base)))


def _start_of(task: Task, rule: Rule, occurrence: datetime) -> Optional[datetime]:
    """An appointment's start for ``occurrence``: the rule's time, or —
    without one ("every tuesday") — the time of day it had."""
    if not task.is_appointment:
        return None
    if rule.has_time or task.start_date is None:
        return occurrence
    clock = timezone.localtime(task.start_date)
    return timezone.localtime(occurrence).replace(hour=clock.hour, minute=clock.minute, second=0, microsecond=0)


def _untouched(series: TaskSeries) -> "Iterable[Task]":
    """Occurrences nobody worked on yet: open, no time, never tracked."""
    return (Task.objects.filter(series=series, completed_at=None, time_spent=timedelta(0))
            .exclude(id__in=TrackingSession.objects.values("task_id")))


def subtasks_refused(task: Task) -> str:
    return (f"“{task.header}” repeats: a recurring task cannot have subtasks. "
            "Add them as separate tasks, or stop the repetition first.")


def _first_anchor(rule: Rule, task: Optional[Task], now: datetime, start: Optional[datetime] = None) -> datetime:
    """Where a rule set on ``task`` starts counting: from this occurrence's
    day (or the appointment's) on, not before now; a rule without a time
    from the start of that day, so today's occurrence still counts."""
    base = start or (task and (task.occurrence or (task.start_date if task.is_appointment else None)))
    reference = now if base is None else max(now, _day_start(base))
    return reference if rule.has_time else _day_start(reference)


def preview(text: str, start: Optional[datetime] = None, count: int = 5,
            now: Optional[datetime] = None) -> Tuple[str, List[datetime]]:
    """The rule in words and its first ``count`` occurrences, for the form —
    from ``start`` (an appointment's) or now, as :func:`make_recurring` would."""
    rule = parse_rule(text)
    return describe(rule), first_occurrences(rule, _first_anchor(rule, None, now or timezone.now(), start), count)


@transaction.atomic
def make_recurring(task: Task, text: str, now: Optional[datetime] = None) -> Task:
    """Let ``task`` repeat by the rule ``text`` from now on, or change the rule
    of its series from this occurrence on (later untouched occurrences are
    replaced). An empty ``text`` stops the repetition after this occurrence.
    Raises :class:`RecurrenceError` with the reason if it cannot."""
    now = now or timezone.now()
    series = task.series
    if not text.strip():
        if series is not None:
            stop_series(task)
        return task
    rule = parse_rule(text)
    if task.children.exists():
        raise RecurrenceError(f"“{task.header}” has subtasks: a task with subtasks cannot repeat. "
                              "Repeat its subtasks instead.")
    if series is not None and series.recurrence == text.strip():
        return task
    anchor = _first_anchor(rule, task, now)
    first = next_occurrence(rule, anchor, anchor - timedelta(minutes=1))
    if first is None:
        raise RecurrenceError(f"“{text.strip()}” does not happen any more.")

    if series is None:
        series = TaskSeries.objects.create(recurrence=text.strip(), anchor=anchor)
    else:
        later = _untouched(series).filter(occurrence__gt=task.occurrence).exclude(id=task.id)
        later.delete()
        series.recurrence, series.anchor = text.strip(), anchor
        series.save(update_fields=["recurrence", "anchor"])
    task.series = series
    if not Task.objects.filter(series=series, occurrence=first).exclude(id=task.id).exists():
        task.occurrence = first
    if task.is_appointment:
        task.start_date = _start_of(task, rule, task.occurrence)
    task.save(update_fields=["series", "occurrence", "start_date"])
    # Made now, not by the next requests — which may come at once (the Tasks
    # tab and the plan) and should not both write.
    _update_series(series, now)
    return task


@transaction.atomic
def stop_series(task: Task) -> None:
    """The repetition ends with ``task``: later untouched occurrences go, the
    rest stay as ordinary tasks."""
    series = task.series
    _untouched(series).filter(occurrence__gt=task.occurrence).exclude(id=task.id).delete()
    Task.objects.filter(series=series).update(series=None, occurrence=None)
    series.delete()
    task.series, task.occurrence = None, None


def _copy(template: Task, rule: Rule, occurrence: datetime) -> Task:
    task = Task(series_id=template.series_id, occurrence=occurrence,
                start_date=_start_of(template, rule, occurrence),
                order=next_sibling_order(template.parent_id),
                **{field: getattr(template, field) for field in COPIED_FIELDS})
    if template.latest_finish_date is not None:
        task.latest_finish_date = _wall_clock_shift(template.latest_finish_date, template.occurrence, occurrence)
    task.save()
    task.tags.set(template.tags.all())
    record_estimate_change(task, None, task.duration, "created")
    return task


def _complete_past_appointments(series: TaskSeries, now: datetime) -> int:
    """A past appointment is done when it ends — unless it is being tracked."""
    tracked = TrackingSession.objects.filter(end=None).values("task_id")
    completed = 0
    for task in (Task.objects.filter(series=series, is_appointment=True, completed_at=None, start_date__lt=now)
                 .exclude(id__in=tracked)):
        end = task.start_date + (task.duration or timedelta(0))
        if end <= now:
            task.completed_at = end
            task.save(update_fields=["completed_at"])
            write_completion_snapshot(task)
            completed += 1
    return completed


def spawn_occurrences(now: Optional[datetime] = None) -> List[Task]:
    """Make the occurrences that are due: an appointment's up to the planning
    horizon, any other task's up to now; past appointments complete
    themselves. Returns the new tasks."""
    return _update(now or timezone.now())[0]


def keep_up(now: Optional[datetime] = None) -> bool:
    """:func:`spawn_occurrences`; True if anything changed (then the
    accepted plan needs recalculating)."""
    created, completed = _update(now or timezone.now())
    return bool(created or completed)


def _update(now: datetime) -> Tuple[List[Task], int]:
    created, completed = [], 0
    for series in TaskSeries.objects.all():
        made, done = _update_series(series, now)
        created += made
        completed += done
    return created, completed


def _update_series(series: TaskSeries, now: datetime) -> Tuple[List[Task], int]:
    try:
        rule = parse_rule(series.recurrence)
    except RecurrenceError:
        return [], 0  # a rule saved before it was refused: nothing to make
    template = Task.objects.filter(series=series).order_by("-occurrence").first()
    if template is None:
        series.delete()  # every occurrence is gone
        return [], 0
    completed = 0
    if template.is_appointment:
        completed = _complete_past_appointments(series, now)
        until = now + timedelta(days=settings.PLANNING_HORIZON_DAYS)
    else:
        until = now
    created = []
    skipped = set(series.skipped)
    for moment in occurrences(rule, series.anchor, template.occurrence + timedelta(minutes=1), until):
        if _key(moment) in skipped:
            continue
        try:
            with transaction.atomic():
                created.append(_copy(template, rule, moment))
        except IntegrityError:
            continue  # made meanwhile by another request
    if created:
        from tasks.services.colors import ensure_auto_colors
        ensure_auto_colors()
    return created, completed


@transaction.atomic
def delete_occurrence(task: Task) -> None:
    """Delete this occurrence only: its date is skipped, the series goes on.
    The last one left hands over to the next occurrence first."""
    series = task.series
    if series is None:
        task.delete()
        return
    series.skipped = sorted(set(series.skipped) | {_key(task.occurrence)})
    series.save(update_fields=["skipped"])
    if not Task.objects.filter(series=series).exclude(id=task.id).exists():
        try:
            rule = parse_rule(series.recurrence)
        except RecurrenceError:
            rule = None
        following = rule and next_after(series, max(task.occurrence, timezone.now()), rule)
        if following is not None:
            _copy(task, rule, following)
    task.delete()
    if not Task.objects.filter(series=series).exists():
        series.delete()


@transaction.atomic
def delete_series(task: Task) -> int:
    """Delete every occurrence of ``task``'s series, done ones too, and the
    series. Returns how many tasks were deleted."""
    series = task.series
    if series is None:
        task.delete()
        return 1
    count, _ = Task.objects.filter(series=series).delete()
    series.delete()
    return count


#: Changes that move with each occurrence's date instead of being copied.
SHIFTED_FIELDS = ("start_date", "latest_finish_date")


@transaction.atomic
def apply_to_following(task: Task, changes: Dict) -> List[Task]:
    """Apply ``changes`` (field values as on ``task``; ``tags`` a list) to the
    open occurrences after ``task``. Dates move along: a deadline set two
    days after this occurrence is two days after each. Returns them."""
    if task.series_id is None:
        return []
    following = list(Task.objects.filter(series_id=task.series_id, occurrence__gt=task.occurrence,
                                         completed_at=None))
    for other in following:
        old_duration = other.duration
        for field, value in changes.items():
            if field == "tags":
                other.tags.set(value)
            elif field in SHIFTED_FIELDS:
                setattr(other, field, None if value is None else
                        _wall_clock_shift(value, task.occurrence, other.occurrence))
            else:
                setattr(other, field, value)
        other.save()
        record_estimate_change(other, old_duration, other.duration, "edited")
    return following


def next_after(series: TaskSeries, moment: datetime, rule: Optional[Rule] = None) -> Optional[datetime]:
    """The series' first date after ``moment`` that is not skipped."""
    try:
        rule = rule or parse_rule(series.recurrence)
    except RecurrenceError:
        return None
    skipped = set(series.skipped)
    found = next_occurrence(rule, series.anchor, moment)
    for _ in range(1000):
        if found is None or _key(found) not in skipped:
            return found
        found = next_occurrence(rule, series.anchor, found)
    return None


def occurrence_counts(series_ids: Iterable) -> Dict:
    """How many occurrences each series has (for “Delete all 12 occurrences”)."""
    return dict(Task.objects.filter(series_id__in=set(series_ids)).values_list("series_id")
                .annotate(count=Count("id")).values_list("series_id", "count"))
