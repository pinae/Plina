"""Markers (README: Calendar): named deadlines move with their marker, and
a marker can become a special bucket, keeping its calendar link."""
from __future__ import annotations

from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone

from tasks.models import CalendarLink, Marker, Task, TimeBucketType


def move_deadlines(marker: Marker) -> int:
    """Tasks whose deadline is ``marker``: due at its start. Returns how many."""
    return Task.objects.filter(deadline_marker=marker).exclude(latest_finish_date=marker.start) \
        .update(latest_finish_date=marker.start)


def is_all_day(marker: Marker) -> bool:
    """From midnight to midnight (in the user's zone)."""
    start = timezone.localtime(marker.start)
    end = timezone.localtime(marker.end)
    return start.time() == time() and end.time() == time() and end.date() > start.date()


@transaction.atomic
def make_special_bucket(marker: Marker, bucket_type: TimeBucketType) -> TimeBucketType:
    """``marker`` becomes the special bucket ``bucket_type`` (saved by the
    caller, its frame set): its calendar link moves along, so the next read
    updates the bucket; the marker goes. Named deadlines keep their date."""
    CalendarLink.objects.filter(marker=marker).update(marker=None, bucket_type=bucket_type, owned=False)
    marker.delete()
    return bucket_type


def default_day_hours() -> tuple[time, timedelta]:
    """A special bucket's working hours each day: the user's Week view frame."""
    from tasks.services.settings import get_settings
    settings = get_settings()
    start, end = settings.week_view_start, settings.week_view_end
    return start, datetime.combine(datetime.min, end) - datetime.combine(datetime.min, start)
