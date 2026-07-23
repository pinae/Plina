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
    """Return all buckets available between ``start`` and ``finish``, sorted by
    start.

    A bucket counts as available if any of it is still ahead of ``start`` — a
    bucket that began before ``start`` but is *ongoing* (ends after it) is
    included so planning can start at the current time, with its usable window
    clamped to ``[start, end]``.  The result is every such persisted bucket
    plus, for each :class:`TimeBucketType`, the generated occurrences that do
    not overlap a persisted bucket.
    """
    persisted = [
        bucket
        for bucket in TimeBucket.objects.filter(start_date__lt=finish).order_by("start_date")
        if bucket.end_date > start
    ]

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
        # Look back by one bucket length so an occurrence that started before
        # ``start`` but is still ongoing is generated too.
        lookback = bucket_type.duration
        for candidate in bucket_type.generate_buckets(
            generation_range=(finish - start) + lookback, start=start - lookback,
        ):
            if candidate.start_date >= finish or candidate.end_date <= start:
                continue
            if (bucket_type.id, candidate.start_date) in moved_origins:
                continue
            if any(_overlaps(candidate, existing) for existing in persisted):
                continue
            generated.append(candidate)

    buckets = sorted(persisted + generated, key=lambda bucket: bucket.start_date)

    # Clamp an ongoing bucket's usable window to the planning start so nothing
    # is scheduled in the past.
    for bucket in buckets:
        if bucket.start_date < start:
            bucket.duration = bucket.end_date - start
            bucket.start_date = start

    return buckets


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
