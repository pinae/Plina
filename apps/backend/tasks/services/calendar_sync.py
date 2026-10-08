"""Calendars from other apps (README: Calendar): Plina reads a calendar's
secret iCal address (Google Calendar: Settings → the calendar → "Secret
address in iCal format") and keeps its events:

* A timed event becomes an appointment: a top-level task in the calendar's
  color. An all-day event becomes a marker (services.markers).
* Each keeps a :class:`CalendarLink` (calendar, UID, occurrence), so the
  next read updates it instead of adding it again. A merge (services.merge)
  moves the link to the task kept; a marker made a special bucket keeps it.
* Updates are three-way against what the last read said: what the calendar
  changed since is taken over — time and place always; title and
  description only if you did not change them in Plina (otherwise the link
  remembers the calendar's version for "Compare with the calendar").
* An event that is gone (deleted, cancelled, declined) takes along what
  Plina made of it if nobody worked on it; otherwise only the link goes.
* Deleting an imported task in Plina dismisses the event: it stays away.

Reads happen when the app asks (``POST /api/calendars/sync/``), at most every
:data:`SYNC_INTERVAL` per calendar — no scheduler needed.
"""
from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from tasks.models import (CalendarLink, CalendarSubscription, Marker, Task, TaskSeries, TimeBucketType,
                          TrackingSession)
from tasks.services import calendar_series
from tasks.services.settings import user_time_zone

SYNC_INTERVAL = timedelta(minutes=10)
#: Read from a day back (an event still going on) to the planning horizon.
LOOKBACK = timedelta(days=1)
MAX_BYTES = 10 * 1024 * 1024
TIMEOUT_SECONDS = 15


class CalendarError(Exception):
    """The calendar could not be read; the message says why, for the user."""


# --- Reading -----------------------------------------------------------------

def normalize_url(url: str) -> str:
    """https (webcal:// is the same), with a host."""
    parts = urlsplit(url.strip())
    if parts.scheme == "webcal":
        parts = parts._replace(scheme="https")
    if parts.scheme != "https" or not parts.hostname:
        raise CalendarError("Use the calendar's https:// address (Google: “Secret address in iCal format”).")
    return urlunsplit(parts)


def check_url(url: str) -> str:
    """The address to read, on a public host — never one in the server's own
    network."""
    parts = urlsplit(normalize_url(url))
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parts.hostname, parts.port or 443)}
    except OSError:
        raise CalendarError(f"“{parts.hostname}” cannot be found. Is the address complete?")
    if not addresses or not all(ipaddress.ip_address(address.split("%")[0]).is_global for address in addresses):
        raise CalendarError(f"“{parts.hostname}” is not a public address.")
    return urlunsplit(parts)


def fetch(url: str) -> bytes:
    """The calendar file (iCal) at ``url``."""
    import requests
    for _ in range(4):  # a few redirects, each checked again
        try:
            response = requests.get(check_url(url), timeout=TIMEOUT_SECONDS, allow_redirects=False, stream=True,
                                    headers={"User-Agent": "Plina calendar sync", "Accept": "text/calendar"})
        except requests.RequestException:
            raise CalendarError("The calendar did not answer. Try again later.")
        if response.is_redirect and response.headers.get("Location"):
            url = requests.compat.urljoin(url, response.headers["Location"])
            continue
        if response.status_code != 200:
            raise CalendarError(f"The calendar answered {response.status_code}. Is the address complete and "
                                "still valid? (Google: a reset secret address makes the old one invalid.)")
        data = b""
        for chunk in response.iter_content(64 * 1024):
            data += chunk
            if len(data) > MAX_BYTES:
                raise CalendarError("The calendar is larger than 10 MB.")
        return data
    raise CalendarError("The calendar's address redirects too often.")


@dataclass
class Event:
    uid: str
    recurrence_id: str  # "" for a single event
    header: str
    description: str
    place: str
    start: datetime
    end: datetime
    all_day: bool

    @property
    def key(self) -> Tuple[str, str]:
        return self.uid, self.recurrence_id

    def data(self) -> Dict:
        """As stored in ``CalendarLink.data``."""
        return {"header": self.header, "description": self.description, "place": self.place,
                "start": _iso(self.start), "end": _iso(self.end), "all_day": self.all_day}


def _iso(moment: datetime) -> str:
    return moment.astimezone(dt_timezone.utc).isoformat()


def _key_moment(value) -> str:
    if isinstance(value, datetime):
        return _iso(value if value.tzinfo else timezone.make_aware(value))
    return value.isoformat()


def _local_midnight(day: date, zone) -> datetime:
    return timezone.make_aware(datetime.combine(day, time()), zone)


def _aware(value: datetime, zone) -> datetime:
    return value if value.tzinfo else timezone.make_aware(value, zone)


def _attendee_answers(component) -> Dict[str, str]:
    attendees = component.get("ATTENDEE")
    if attendees is None:
        return {}
    if not isinstance(attendees, list):
        attendees = [attendees]
    return {str(attendee).lower().removeprefix("mailto:"): str(attendee.params.get("PARTSTAT", "")).upper()
            for attendee in attendees}


def _calendar_zone(calendar):
    """The calendar's own zone (Google: ``X-WR-TIMEZONE``), if it names one."""
    name = str(calendar.get("X-WR-TIMEZONE") or "").strip()
    try:
        return ZoneInfo(name) if name else None
    except (ZoneInfoNotFoundError, ValueError):
        return None


def read_events(data: bytes, start: datetime, end: datetime, zone=None, email: str = "") -> List[Event]:
    """The events from ``start`` to ``end``, repeating ones as their
    occurrences; cancelled ones and those ``email`` declined left out.
    All-day events and floating times are in ``zone``, else the calendar's
    zone, else the current one."""
    import icalendar
    import recurring_ical_events
    try:
        calendar = icalendar.Calendar.from_ical(data)
    except ValueError:
        raise CalendarError("This is not a calendar (iCal) file. Use the address in iCal format.")
    zone = zone or _calendar_zone(calendar) or timezone.get_current_timezone()
    repeating: Set[str] = {str(component.get("UID")) for component in calendar.walk("VEVENT")
                           if any(key in component for key in ("RRULE", "RDATE", "RECURRENCE-ID"))}
    email = email.strip().lower()
    events = []
    try:
        components = recurring_ical_events.of(calendar).between(start, end)
    except Exception as error:  # the library raises various errors on broken rules
        raise CalendarError(f"The calendar could not be read: {error}")
    for component in components:
        uid = str(component.get("UID") or "")
        if not uid or str(component.get("STATUS", "")).upper() == "CANCELLED":
            continue
        if email and _attendee_answers(component).get(email) == "DECLINED":
            continue
        first = component.get("DTSTART").dt
        last = component.get("DTEND").dt if component.get("DTEND") is not None else None
        all_day = not isinstance(first, datetime)
        if all_day:
            event_start = _local_midnight(first, zone)
            event_end = _local_midnight(last if isinstance(last, date) and last > first else first + timedelta(days=1),
                                        zone)
        else:
            event_start = _aware(first, zone)
            if last is None and component.get("DURATION") is not None:
                last = first + component.get("DURATION").dt
            event_end = _aware(last, zone) if isinstance(last, datetime) else event_start
        recurrence = component.get("RECURRENCE-ID")
        events.append(Event(
            uid=uid,
            recurrence_id=_key_moment(recurrence.dt) if uid in repeating and recurrence is not None else "",
            header=str(component.get("SUMMARY") or "").strip() or "(no title)",
            description=str(component.get("DESCRIPTION") or "").strip(),
            place=str(component.get("LOCATION") or "").strip(),
            start=event_start, end=max(event_end, event_start), all_day=all_day,
        ))
    return events


@dataclass
class Repeating:
    """A repeating event's rule as the calendar has it."""
    rrule: Dict[str, list]  # e.g. {"FREQ": ["WEEKLY"], "BYDAY": ["TU"]}
    start: datetime  # its first occurrence (DTSTART)


def read_repeating(data: bytes, zone=None) -> Dict[str, Repeating]:
    """The rules of the repeating timed events, by UID (README: Calendar)."""
    import icalendar
    try:
        calendar = icalendar.Calendar.from_ical(data)
    except ValueError:
        return {}
    zone = zone or _calendar_zone(calendar) or timezone.get_current_timezone()
    found = {}
    for component in calendar.walk("VEVENT"):
        if component.get("RRULE") is None or component.get("RECURRENCE-ID") is not None:
            continue
        first = component.get("DTSTART").dt
        if not isinstance(first, datetime):
            continue  # all-day: markers
        rrule = {str(key).upper(): list(value) for key, value in component.get("RRULE").items()}
        found[str(component.get("UID"))] = Repeating(rrule=rrule, start=_aware(first, zone))
    return found


# --- Keeping them --------------------------------------------------------------

@dataclass
class SyncResult:
    created: int = 0
    updated: int = 0
    removed: int = 0
    completed: int = 0

    @property
    def changed(self) -> bool:
        return bool(self.created or self.updated or self.removed or self.completed)


#: Event field -> Plina field, per kind of object.
TASK_FIELDS = {"header": "header", "description": "description", "place": "place"}
MARKER_FIELDS = {"header": "title", "description": "description", "place": "place"}
#: Taken over only if not changed in Plina; the others always.
OWN_WORDS = {"header", "description"}


def _untouched(task: Task) -> bool:
    return (task.completed_at is None and task.time_spent == timedelta(0)
            and not TrackingSession.objects.filter(task=task).exists())


def _bring(subscription: CalendarSubscription, event: Event, series: Optional[TaskSeries]) -> CalendarLink:
    """A new event: an occurrence of the recurring task that follows it, if
    it fits (else that switches to asking, README: Calendar), or a task or
    marker of its own."""
    if series is not None and series.calendar_auto:
        reason = calendar_series.mismatch(series, calendar_series.slot_of(event.recurrence_id),
                                          event.start, event.end, event.header)
        if reason is None:
            return calendar_series.place(subscription, series, event)
        calendar_series.switch_off(series, reason)
    return _create(subscription, event)


def _create(subscription: CalendarSubscription, event: Event) -> CalendarLink:
    from tasks.services.colors import from_hex
    from tasks.services.estimates import record_estimate_change
    from tasks.services.tree import next_sibling_order
    link = CalendarLink(subscription=subscription, uid=event.uid, recurrence_id=event.recurrence_id,
                        data=event.data(), start=event.start)
    if event.all_day:
        link.marker = Marker.objects.create(title=event.header, description=event.description, place=event.place,
                                            start=event.start, duration=event.end - event.start)
    else:
        task = Task.objects.create(
            header=event.header, description=event.description, place=event.place, is_appointment=True,
            start_date=event.start, duration=event.end - event.start, color=from_hex(subscription.hex_color),
            order=next_sibling_order(None))
        record_estimate_change(task, None, task.duration, "created")
        link.task = task
    link.save()
    return link


def _update(link: CalendarLink, event: Event) -> bool:
    """Take over what the calendar changed since the last read."""
    base, new = link.data, event.data()
    if base == new:
        return False
    changed = {key for key in new if new[key] != base.get(key)}
    pending = set(link.pending)
    if link.task is not None:
        task = link.task
        for key, field_name in TASK_FIELDS.items():
            if key not in changed:
                continue
            if key in OWN_WORDS and getattr(task, field_name) != base.get(key, ""):
                pending.add(key)  # changed in Plina too: kept, offered for comparing
            else:
                setattr(task, field_name, new[key])
                pending.discard(key)
        if changed & {"start", "end"}:
            task.start_date, task.duration = event.start, event.end - event.start
        task.save()
    elif link.marker is not None:
        marker = link.marker
        for key, field_name in MARKER_FIELDS.items():
            if key in changed:
                if key in OWN_WORDS and getattr(marker, field_name) != base.get(key, ""):
                    pending.add(key)
                else:
                    setattr(marker, field_name, new[key])
                    pending.discard(key)
        if changed & {"start", "end"}:
            marker.start, marker.duration = event.start, event.end - event.start
        marker.save()
        from tasks.services.markers import move_deadlines
        move_deadlines(marker)
    elif link.bucket_type is not None:
        bucket_type = link.bucket_type
        if "header" in changed:
            if bucket_type.name == base.get("header"):
                bucket_type.name = event.header
            else:
                pending.add("header")
        if changed & {"start", "end"}:
            bucket_type.special_start, bucket_type.special_end = event.start, event.end
        bucket_type.save()
    link.data, link.start, link.pending = new, event.start, sorted(pending)
    link.save(update_fields=["data", "start", "pending"])
    return True


def remove_link(link: CalendarLink) -> None:
    """The event is gone: what Plina made of it goes too, unless worked on,
    merged into a task of yours or made a special bucket."""
    if link.owned:
        if link.task is not None and _untouched(link.task):
            link.task.delete()
        elif link.marker is not None:
            link.marker.delete()
    link.delete()


def _complete_past(links: Iterable[CalendarLink], now: datetime) -> int:
    """An imported appointment is done when it ends, unless it is being tracked."""
    completed = 0
    tracked = set(TrackingSession.objects.filter(end=None).values_list("task_id", flat=True))
    for link in links:
        task = link.task
        if (task is None or not task.is_appointment or task.completed_at is not None or task.start_date is None
                or task.id in tracked):
            continue
        end = task.start_date + (task.duration or timedelta(0))
        if end <= now:
            from tasks.services.estimates import write_completion_snapshot
            task.completed_at = end
            task.save(update_fields=["completed_at"])
            write_completion_snapshot(task)
            completed += 1
    return completed


def sync(subscription: CalendarSubscription, now: Optional[datetime] = None,
         data: Optional[bytes] = None) -> SyncResult:
    """Read the calendar once and keep its events (``data``: already read)."""
    now = now or timezone.now()
    if data is None:
        data = fetch(subscription.url)
    window_start, window_end = now - LOOKBACK, now + timedelta(days=settings.PLANNING_HORIZON_DAYS)
    # The user's days, also before the app told the server its zone (then the calendar's).
    zone = user_time_zone()
    events = read_events(data, window_start, window_end, zone=zone, email=subscription.email)
    repeating = read_repeating(data, zone=zone)
    result = SyncResult()
    # Rules ("every tuesday at 10:00") mean the user's wall-clock time, also
    # when no request activated their zone.
    with timezone.override(zone or timezone.get_current_timezone()), transaction.atomic():
        links = {(link.uid, link.recurrence_id): link for link in
                 CalendarLink.objects.filter(subscription=subscription)
                 .select_related("task", "marker", "bucket_type")}
        # Repeating events whose occurrences were all deleted: not again.
        dismissed = {uid for uid, recurrence_id in links if recurrence_id == calendar_series.DISMISSED}
        # The occurrences of a repeating event join one recurring task.
        occurrences: Dict[str, List[Event]] = {}
        for event in events:
            if event.recurrence_id and not event.all_day and event.uid not in dismissed:
                occurrences.setdefault(event.uid, []).append(event)
        series_of = {uid: calendar_series.series_for(subscription, uid, found, repeating)
                     for uid, found in occurrences.items()}
        seen = set()
        for event in events:
            if event.key in seen:
                continue
            seen.add(event.key)
            if event.uid in dismissed:
                continue
            link = links.get(event.key)
            if link is None:
                links[event.key] = _bring(subscription, event, series_of.get(event.uid))
                result.created += 1
            elif _update(link, event):
                result.updated += 1
        for key, link in list(links.items()):
            if key[1] == calendar_series.DISMISSED:
                continue
            if key not in seen and link.start >= now:  # a coming event that is gone
                remove_link(link)
                result.removed += 1
        # A repeating event gone from the calendar: its empty series too.
        TaskSeries.objects.filter(calendar_subscription=subscription, occurrences__isnull=True) \
            .exclude(calendar_uid__in=list(occurrences)).delete()
        for uid, series in series_of.items():
            if series is not None and series.calendar_auto:
                calendar_series.adopt(series)
                calendar_series.clear_unknown(
                    series, [calendar_series.slot_of(event.recurrence_id) for event in occurrences[uid]],
                    now, window_end)
        result.completed = _complete_past(
            CalendarLink.objects.filter(subscription=subscription, task__isnull=False).select_related("task"), now)
    if result.created:
        from tasks.services.colors import ensure_auto_colors
        ensure_auto_colors()
    return result


def sync_due(now: Optional[datetime] = None, force: bool = False) -> bool:
    """Read every calendar not read for :data:`SYNC_INTERVAL` (``force``: all
    now); True if anything changed. Two requests at once read a calendar
    once: the first one claims it."""
    now = now or timezone.now()
    changed = False
    for subscription in CalendarSubscription.objects.all():
        attempted = subscription.last_attempt_at
        if not force and attempted is not None and now - attempted < SYNC_INTERVAL:
            continue
        claimed = CalendarSubscription.objects.filter(id=subscription.id, last_attempt_at=attempted) \
            .update(last_attempt_at=now)
        if not claimed:
            continue
        try:
            changed = sync(subscription, now).changed or changed
            subscription.last_synced_at, subscription.last_error = now, ""
        except CalendarError as error:
            subscription.last_error = str(error)
        subscription.last_attempt_at = now
        subscription.save(update_fields=["last_synced_at", "last_error", "last_attempt_at"])
    return changed


@transaction.atomic
def unsubscribe(subscription: CalendarSubscription) -> None:
    """Stop reading a calendar: its coming events that Plina made and nobody
    worked on go, everything else stays as yours."""
    now = timezone.now()
    for link in CalendarLink.objects.filter(subscription=subscription).select_related("task__series", "marker"):
        if link.task is not None and link.task.series is not None \
                and link.task.series.calendar_subscription_id == subscription.id:
            continue  # a recurring task now: its rule makes the occurrences from here on
        if link.start >= now:
            remove_link(link)
    subscription.delete()
