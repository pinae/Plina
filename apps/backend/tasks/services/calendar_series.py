"""Repeating calendar events as recurring tasks (README: Calendar).

The occurrences of a repeating event (one UID, many RECURRENCE-IDs) are the
occurrences of one :class:`TaskSeries` that follows the event: in the Tasks
tab one row, ↻, like any recurring task.

* The series has a rule in Plina's words, made from the calendar's
  ("every tuesday at 10:00"), or the rule of a recurring task of yours that
  an occurrence was merged into. The calendar says which occurrences there
  are (exceptions, moved ones, the end); the rule checks that they fit.
* ``calendar_auto`` ("include new occurrences without asking"): a new
  occurrence that fits — on a date of the rule at its time, as long as the
  others — joins the series by itself. One that does not fit switches it
  off (``calendar_mismatch`` says why) and comes as a task of its own; once
  the rule is changed to fit and it is switched on again, they join.
* An occurrence moved on its own in the calendar fits by its original date
  (RECURRENCE-ID) and takes the new time.
* While it follows a calendar, the series makes no occurrences itself;
  without the calendar (removed) its rule makes them again.
* Deleting all occurrences dismisses the event: later ones do not come.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional

from django.utils import timezone

from tasks.models import CalendarLink, CalendarSubscription, Task, TaskSeries
from tasks.services.recurrence import RecurrenceError, next_occurrence, parse_rule

#: The link that marks a repeating event of which all occurrences were deleted.
DISMISSED = "*"

DAYS = {"MO": "monday", "TU": "tuesday", "WE": "wednesday", "TH": "thursday", "FR": "friday",
        "SA": "saturday", "SU": "sunday"}
WEEK = list(DAYS)
ORDINALS = {1: "first", 2: "second", 3: "third", 4: "fourth", -1: "last"}
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"]
#: The parts of a calendar rule Plina can say (UNTIL/COUNT: the calendar decides the end).
SAYABLE = {"FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "UNTIL", "COUNT", "WKST"}


def _nth(day: int) -> str:
    suffix = "th" if 10 <= day % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def _and(words: List[str]) -> str:
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def rule_text(rrule: Dict[str, list], start: datetime) -> Optional[str]:
    """The calendar's repeat rule (RRULE) in Plina's words, at the time of
    ``start`` (its first occurrence) — or None for one Plina does not say."""
    if set(rrule) - SAYABLE:
        return None
    local = timezone.localtime(start)
    at = f"at {local:%H:%M}"
    freq = str((rrule.get("FREQ") or [""])[0]).upper()
    interval = int((rrule.get("INTERVAL") or [1])[0])
    byday = [str(day).upper() for day in rrule.get("BYDAY", [])]
    bymonthday = [int(day) for day in rrule.get("BYMONTHDAY", [])]
    if freq == "DAILY" and not byday and not bymonthday:
        return f"every day {at}" if interval == 1 else f"every {interval} days {at}"
    if freq == "WEEKLY" and not bymonthday:
        days = byday or [WEEK[local.weekday()]]
        if any(day not in DAYS for day in days):
            return None
        if interval == 1 and set(days) == {"MO", "TU", "WE", "TH", "FR"}:
            return f"every weekday {at}"
        names = _and([DAYS[day] for day in sorted(set(days), key=WEEK.index)])
        return f"every {names} {at}" if interval == 1 else f"every {interval} weeks on {names} {at}"
    if freq == "MONTHLY":
        if byday and not bymonthday and len(byday) == 1 and byday[0][-2:] in DAYS:
            try:
                which = ORDINALS[int(byday[0][:-2])]
            except (KeyError, ValueError):
                return None
            what = f"{which} {DAYS[byday[0][-2:]]}"
        elif not byday and len(bymonthday) <= 1 and all(day > 0 for day in bymonthday):
            what = _nth(bymonthday[0] if bymonthday else local.day)
        else:
            return None
        return f"every {what} of the month {at}" if interval == 1 else f"every {interval} months on the {what} {at}"
    if freq == "YEARLY" and interval == 1 and not byday and len(bymonthday) <= 1:
        month = int((rrule.get("BYMONTH") or [local.month])[0])
        return f"every {_nth(bymonthday[0] if bymonthday else local.day)} of {MONTHS[month - 1]} {at}"
    return None


def slot_of(recurrence_id: str) -> datetime:
    """An occurrence's original date (its RECURRENCE-ID, as stored)."""
    return datetime.fromisoformat(recurrence_id)


def _moment(value: datetime) -> str:
    return f"{timezone.localtime(value):%a %d/%m %H:%M}"


def _length(value: timedelta) -> str:
    minutes = round(value.total_seconds() / 60)
    hours, rest = divmod(minutes, 60)
    return " ".join(part for part in (f"{hours}h" if hours else "", f"{rest}m" if rest else "") if part) or "0m"


def _fits_rule(text: str, anchor: datetime, slot: datetime) -> bool:
    rule = parse_rule(text)
    if rule.has_time:
        return next_occurrence(rule, anchor, slot - timedelta(seconds=1)) == slot
    day = timezone.localtime(slot).replace(hour=0, minute=0, second=0, microsecond=0)
    return next_occurrence(rule, anchor, day - timedelta(seconds=1)) == day


def _regular_length(series: TaskSeries) -> Optional[timedelta]:
    """How long the series' occurrences take: the latest one not moved on its own."""
    for task in Task.objects.filter(series=series).exclude(start_date=None).order_by("-occurrence"):
        if task.start_date == task.occurrence:
            return task.duration
    return None


def mismatch(series: TaskSeries, slot: datetime, start: datetime, end: datetime, header: str) -> Optional[str]:
    """Why an occurrence (originally at ``slot``, now ``start`` to ``end``)
    does not fit the series — None if it does."""
    name = series.calendar_subscription.name if series.calendar_subscription else "The calendar"
    try:
        fits = _fits_rule(series.recurrence, series.anchor, slot)
    except RecurrenceError:
        fits = False
    if not fits:
        return (f"{name} has “{header}” on {_moment(slot)}, which “{series.recurrence}” does not have. "
                "Change the rule to fit, then switch this on again.")
    if start == slot:  # not moved on its own: as long as the others
        regular = _regular_length(series)
        if regular is not None and end - start != regular:
            return (f"“{header}” on {_moment(slot)} takes {_length(end - start)}, the other occurrences "
                    f"{_length(regular)}. Change the duration of the following ones to fit, "
                    "then switch this on again.")
    return None


def followed(task: Task) -> Optional[TaskSeries]:
    """The series that follows ``task``'s repeating event — also when the
    task came on its own (it did not fit): there its rule is fixed."""
    if task.series_id is not None:
        return task.series
    link = task.calendar_links.exclude(recurrence_id="").first()
    if link is None:
        return None
    return TaskSeries.objects.filter(calendar_subscription_id=link.subscription_id, calendar_uid=link.uid).first()


def switch_off(series: TaskSeries, reason: str) -> None:
    series.calendar_auto, series.calendar_mismatch = False, reason
    series.save(update_fields=["calendar_auto", "calendar_mismatch"])


def series_for(subscription: CalendarSubscription, uid: str, events: List, repeating: Dict) -> Optional[TaskSeries]:
    """The series that the occurrences ``events`` of ``uid`` join: the one
    following the event; else the recurring task of yours one of them was
    merged into (it follows the event from now on); else a new one with the
    calendar's rule in Plina's words — None if Plina cannot say the rule or
    it does not give the calendar's dates."""
    # One of yours that an occurrence was merged into wins over the one made
    # for the event: that one's occurrences join yours.
    merged = (CalendarLink.objects.filter(subscription=subscription, uid=uid, task__series__isnull=False,
                                          task__series__calendar_subscription__isnull=True)
              .select_related("task__series").first())
    if merged is not None:
        series = merged.task.series
        for made in TaskSeries.objects.filter(calendar_subscription=subscription, calendar_uid=uid):
            Task.objects.filter(series=made).update(series=None, occurrence=None)
            made.delete()
        series.calendar_subscription, series.calendar_uid = subscription, uid
        series.calendar_auto, series.calendar_mismatch = True, ""
        series.save(update_fields=["calendar_subscription", "calendar_uid", "calendar_auto", "calendar_mismatch"])
        return series
    series = TaskSeries.objects.filter(calendar_subscription=subscription, calendar_uid=uid).first()
    if series is not None:
        return series
    info = repeating.get(uid)
    text = info and rule_text(info.rrule, info.start)
    if not text:
        return None
    try:
        if not all(_fits_rule(text, info.start, slot_of(event.recurrence_id)) for event in events):
            return None
    except RecurrenceError:
        return None
    return TaskSeries.objects.create(recurrence=text, anchor=info.start, calendar_subscription=subscription,
                                     calendar_uid=uid)


def _words(template: Optional[Task], key: str, event) -> str:
    """A new occurrence's title or description: yours if you changed it on
    the occurrence before, else the calendar's."""
    if template is not None:
        link = template.calendar_links.first()
        if link is not None and getattr(template, key) != link.data.get(key, getattr(template, key)):
            return getattr(template, key)
    return getattr(event, key)


def place(subscription: CalendarSubscription, series: TaskSeries, event) -> CalendarLink:
    """The occurrence of ``series`` for ``event``: the one at that date made
    before (a recurring task of yours that follows the event now), else a
    new one like the latest — the calendar's time and place, your tags,
    priority, color and project."""
    from tasks.services.colors import from_hex
    from tasks.services.estimates import record_estimate_change
    from tasks.services.tree import next_sibling_order
    slot = slot_of(event.recurrence_id)
    link = CalendarLink(subscription=subscription, uid=event.uid, recurrence_id=event.recurrence_id,
                        data=event.data(), start=event.start)
    task = Task.objects.filter(series=series, occurrence=slot).first()
    if task is not None:
        link.pending = [key for key in ("header", "description") if getattr(task, key) != getattr(event, key)]
        task.start_date, task.duration = event.start, event.end - event.start
        task.place = event.place or task.place
        task.is_unplanned = event.maybe
        task.save(update_fields=["start_date", "duration", "place", "is_unplanned"])
    else:
        template = Task.objects.filter(series=series).order_by("-occurrence").first()
        parent_id = template.parent_id if template else None
        task = Task.objects.create(
            header=_words(template, "header", event), description=_words(template, "description", event),
            place=event.place, is_appointment=True, is_unplanned=event.maybe,
            start_date=event.start, duration=event.end - event.start,
            priority=template.priority if template else 5,
            color=template.color if template else from_hex(subscription.hex_color),
            auto_color=template.auto_color if template else None,
            parent_id=parent_id, series=series, occurrence=slot, order=next_sibling_order(parent_id))
        if template is not None:
            task.tags.set(template.tags.all())
        record_estimate_change(task, None, task.duration, "created")
    link.task = task
    link.save()
    return link


def _occurrence_data(link: CalendarLink):
    start = datetime.fromisoformat(link.data["start"])
    end = datetime.fromisoformat(link.data["end"])
    return slot_of(link.recurrence_id), start, end, link.data.get("header", "")


def adopt(series: TaskSeries) -> None:
    """Occurrences of the event that came as tasks of their own (before the
    series followed it, or while it asked) join it, as long as they fit;
    one at a date the series has already is merged into that one."""
    from tasks.services.merge import MergeError, merge_into
    if not series.calendar_auto or series.calendar_subscription_id is None:
        return
    links = (CalendarLink.objects.filter(subscription_id=series.calendar_subscription_id, uid=series.calendar_uid,
                                         task__isnull=False)
             .exclude(recurrence_id__in=["", DISMISSED]).select_related("task").order_by("start"))
    for link in links:
        task = link.task
        if task.series_id is not None or task.children.exists():
            continue  # in a series already, or holds subtasks: stays as it is
        slot, start, end, header = _occurrence_data(link)
        reason = mismatch(series, slot, start, end, header or task.header)
        if reason:
            switch_off(series, reason)
            return
        existing = Task.objects.filter(series=series, occurrence=slot).first()
        if existing is None:
            task.series, task.occurrence = series, slot
            task.save(update_fields=["series", "occurrence"])
            continue
        try:
            merge_into(existing, task)
        except MergeError:
            continue
        existing.start_date, existing.duration = start, end - start
        existing.place = link.data.get("place") or existing.place
        existing.save(update_fields=["start_date", "duration", "place"])
    # The calendar removes what it cancels: its links own the occurrences.
    CalendarLink.objects.filter(subscription_id=series.calendar_subscription_id, uid=series.calendar_uid,
                                task__series=series).update(owned=True)


def clear_unknown(series: TaskSeries, slots: Iterable[datetime], now: datetime, until: datetime) -> None:
    """The calendar decides which occurrences there are: one the series made
    itself (before it followed the event) at a date the calendar does not
    have goes, unless worked on."""
    from tasks.services.calendar_sync import _untouched
    known = set(slots)
    for task in Task.objects.filter(series=series, completed_at=None, calendar_links__isnull=True,
                                    occurrence__gte=now, occurrence__lt=until):
        if task.occurrence not in known and _untouched(task):
            task.delete()


def recheck(series: TaskSeries) -> None:
    """After the rule changed or the switch went on: do the occurrences from
    the calendar fit? Those that came on their own join."""
    if series.calendar_subscription_id is None or not series.calendar_auto:
        return
    links = (CalendarLink.objects.filter(subscription_id=series.calendar_subscription_id, uid=series.calendar_uid,
                                         task__series=series, task__completed_at=None)
             .exclude(recurrence_id__in=["", DISMISSED]).select_related("task"))
    for link in links:
        slot, start, end, header = _occurrence_data(link)
        reason = mismatch(series, slot, start, end, header or link.task.header)
        if reason:
            switch_off(series, reason)
            return
    adopt(series)


def set_auto(series: TaskSeries, value: bool) -> None:
    """The switch "include new occurrences without asking"."""
    series.calendar_auto, series.calendar_mismatch = value, ""
    series.save(update_fields=["calendar_auto", "calendar_mismatch"])
    if value:
        recheck(series)


def dismiss(series: TaskSeries) -> None:
    """All occurrences are being deleted: the event's later ones must not come."""
    if series.calendar_subscription_id is None:
        return
    CalendarLink.objects.get_or_create(
        subscription_id=series.calendar_subscription_id, uid=series.calendar_uid, recurrence_id=DISMISSED,
        defaults={"data": {}, "owned": False, "start": timezone.now()})
