"""Collecting the available time buckets for a planning horizon.

Hand-placed buckets stored in the database always win; recurring
:class:`~tasks.models.TimeBucketType` rules only fill the slots that are not
already covered.  Generated buckets are *not* persisted here — they stay
in-memory until a plan that uses them is accepted.
"""
from __future__ import annotations

from datetime import datetime
from typing import List

from tasks.models import TimeBucket, TimeBucketType


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

    generated: List[TimeBucket] = []
    for bucket_type in TimeBucketType.objects.all():
        for candidate in bucket_type.generate_buckets(generation_range=finish - start, start=start):
            if candidate.start_date >= finish:
                continue
            if any(_overlaps(candidate, existing) for existing in persisted):
                continue
            generated.append(candidate)

    return sorted(persisted + generated, key=lambda bucket: bucket.start_date)
