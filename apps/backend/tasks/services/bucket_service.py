"""Collecting the available time buckets for a planning horizon.

Hand-placed buckets stored in the database always win; recurring
:class:`~tasks.models.TimeBucketType` rules only fill the slots that are not
already covered.  Generated buckets are *not* persisted here — they stay
in-memory until a plan that uses them is accepted.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import List

from tasks.models import TimeBucket, TimeBucketType
from tasks.services.graph import CapacityWindow


def capacity_windows(buckets: List[TimeBucket]) -> List[CapacityWindow]:
    """Convert buckets into pure :class:`CapacityWindow` objects.

    This is the boundary between the ORM and the pure analysis functions in
    ``services.graph``: everything past this point is database-free.
    """
    return [
        CapacityWindow(
            start=bucket.start_date,
            end=bucket.end_date,
            tag_ids=frozenset(tag.id for tag in bucket.type.tags.all()),
        )
        for bucket in buckets
    ]


def _overlaps(a: TimeBucket, b: TimeBucket) -> bool:
    return a.start_date < b.end_date and b.start_date < a.end_date


def gather_time_buckets(start: datetime, finish: datetime) -> List[TimeBucket]:
    """Return all buckets between ``start`` and ``finish``, sorted by start.

    The result contains every persisted bucket in the range plus, for each
    :class:`TimeBucketType`, the generated occurrences that do not overlap
    any persisted bucket.
    """
    persisted = list(
        TimeBucket.objects
        .filter(start_date__gte=start, start_date__lt=finish)
        .order_by("start_date")
    )

    # Occurrences that were individually moved/resized: their materialized
    # bucket records the original generated slot it replaces, so the rule must
    # not regenerate a duplicate there (even after it no longer overlaps).
    moved_origins = {
        (bucket.type_id, bucket.origin_date)
        for bucket in persisted
        if bucket.origin_date is not None
    }

    generated: List[TimeBucket] = []
    for bucket_type in TimeBucketType.objects.all():
        for candidate in bucket_type.generate_buckets(generation_range=finish - start, start=start):
            if candidate.start_date >= finish:
                continue
            if (bucket_type.id, candidate.start_date) in moved_origins:
                continue
            if any(_overlaps(candidate, existing) for existing in persisted):
                continue
            generated.append(candidate)

    return sorted(persisted + generated, key=lambda bucket: bucket.start_date)


class RecurrenceError(ValueError):
    """The given string is not a recognizable recurrence rule."""


def preview_occurrences(start_times: str, count: int = 5) -> List[datetime]:
    """The next ``count`` occurrences of a recurrence string, for form preview.

    Raises :class:`RecurrenceError` for empty/unparseable rules — unlike
    ``generate_buckets``, the preview must *tell* the user what is wrong.
    """
    if not start_times.strip():
        raise RecurrenceError("Please enter a recurrence rule, e.g. “every weekday at 09:00”.")
    probe = TimeBucketType(name="preview", start_times=start_times,
                           duration=timedelta(hours=1))
    buckets = probe.generate_buckets(generation_range=timedelta(days=366))
    if not buckets:
        raise RecurrenceError(
            f"“{start_times}” is not a recognizable recurrence rule."
        )
    return [bucket.start_date for bucket in buckets[:count]]
