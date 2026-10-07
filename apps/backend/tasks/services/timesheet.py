"""The time sheet (README: Time sheet): per day, when work began and ended
and how long the pauses were — from the tracked time.

* **Work** is time tracked on a task tagged #Arbeit or #Work. A day begins
  with the first stretch of work and ends with the last one.
* **Pause** is time tracked on a task tagged #Freizeit or #Freetime (and not
  #Arbeit or #Work), counted between that begin and end; free time before
  work or after it is no pause.
* The working time is the span from begin to end without the pauses.

Days are the user's days (the active time zone). A session counts on the
day it began, also when it goes on after midnight (the day then ends on the
next one); a running one counts until now. Tags count by name, in any case,
with or without "#".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional

from django.utils import timezone

from tasks.models import TrackingSession

WORK_TAGS = ("Arbeit", "Work")
PAUSE_TAGS = ("Freizeit", "Freetime")
#: At most this many days at once (a year).
MAX_DAYS = 366


def _names(names) -> frozenset:
    return frozenset(name.lstrip("#").casefold() for name in names)


_WORK = _names(WORK_TAGS)
_PAUSE = _names(PAUSE_TAGS)


def kind_of(tag_names) -> Optional[str]:
    """"work", "pause" or None (not on the time sheet)."""
    names = _names(tag_names)
    if names & _WORK:
        return "work"
    if names & _PAUSE:
        return "pause"
    return None


@dataclass
class Entry:
    """A task counted on a day, with its time on that day."""
    task_id: str
    header: str
    tags: List[dict]
    kind: str
    seconds: int = 0
    #: Being tracked right now.
    running: bool = False
    first_start: Optional[datetime] = None


@dataclass
class Day:
    date: date
    begin: datetime
    end: datetime
    pause_seconds: int
    #: Still being worked on (the end is now).
    running: bool
    entries: List[Entry] = field(default_factory=list)

    @property
    def working_seconds(self) -> int:
        return max(0, round((self.end - self.begin).total_seconds()) - self.pause_seconds)


def _midnight(day: date, zone) -> datetime:
    return timezone.make_aware(datetime.combine(day, time()), zone)


def _clip(start: datetime, end: datetime, low: datetime, high: datetime) -> float:
    return max(0.0, (min(end, high) - max(start, low)).total_seconds())


def time_sheet(first: date, last: date, now: Optional[datetime] = None, zone=None) -> List[Day]:
    """The days from ``first`` to ``last`` (both included) on which work was
    tracked, oldest first."""
    zone = zone or timezone.get_current_timezone()
    now = now or timezone.now()
    window_start, window_end = _midnight(first, zone), _midnight(last + timedelta(days=1), zone)
    sessions = (TrackingSession.objects.filter(start__gte=window_start, start__lt=window_end)
                .select_related("task").prefetch_related("task__tags").order_by("start"))
    # Per day (the one it began on): the sessions of work and pause, with their task.
    pieces: Dict[date, list] = {}
    for session in sessions:
        tags = list(session.task.tags.all())
        kind = kind_of(tag.name for tag in tags)
        if kind is None:
            continue
        end = session.end or max(now, session.start)
        day = timezone.localtime(session.start, zone).date()
        pieces.setdefault(day, []).append((kind, session.start, end, session, tags))

    days = []
    for day in sorted(pieces):
        work = [piece for piece in pieces[day] if piece[0] == "work"]
        if not work:
            continue  # no work, no time sheet entry
        begin = min(start for _, start, _, _, _ in work)
        end = max(stop for _, _, stop, _, _ in work)
        entries: Dict[str, Entry] = {}
        pause = 0.0
        for kind, start, stop, session, tags in pieces[day]:
            seconds = (stop - start).total_seconds() if kind == "work" else _clip(start, stop, begin, end)
            if seconds <= 0:
                continue  # free time outside the working day
            if kind == "pause":
                pause += seconds
            task = session.task
            entry = entries.get(str(task.id))
            if entry is None:
                entry = entries[str(task.id)] = Entry(
                    task_id=str(task.id), header=task.header, kind=kind, first_start=max(start, begin),
                    tags=[{"id": str(tag.id), "name": tag.name, "hex_color": tag.hex_color} for tag in tags])
            entry.seconds += seconds
            entry.running = entry.running or session.end is None
        for entry in entries.values():
            entry.seconds = round(entry.seconds)
        running = any(session.end is None and stop == end for kind, _, stop, session, _ in work)
        days.append(Day(date=day, begin=begin, end=end, pause_seconds=round(pause), running=running,
                        entries=sorted(entries.values(), key=lambda entry: entry.first_start)))
    return days
