"""Regression: moving a single recurring bucket occurrence must not leave a
duplicate behind.

The frontend materializes a moved generated occurrence as a persisted
TimeBucket whose ``origin_date`` records the slot it replaces; the recurrence
rule must then skip regenerating that slot even though the moved bucket no
longer overlaps it.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from tasks.models import TimeBucket, TimeBucketType
from tasks.services.bucket_service import gather_time_buckets


class BucketMoveSuppressionTest(TestCase):
    def setUp(self):
        # A recurring 2h bucket every day at 09:00.
        self.start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        self.bucket_type = TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00", duration=timedelta(hours=2),
        )

    def _first_occurrence(self):
        buckets = gather_time_buckets(self.start, self.start + timedelta(days=2))
        return buckets[0]

    def test_recurrence_generates_daily_occurrences(self):
        buckets = gather_time_buckets(self.start, self.start + timedelta(days=3))
        # 09:00 on each of the three days.
        self.assertEqual(len(buckets), 3)
        self.assertTrue(all(b.start_date.hour == 9 for b in buckets))

    def test_moving_a_generated_occurrence_does_not_duplicate_it(self):
        original = self._first_occurrence()
        original_start = original.start_date

        # Materialize it moved to 14:00 the same day, recording its origin slot.
        moved_start = original_start.replace(hour=14)
        TimeBucket.objects.create(
            type=self.bucket_type, start_date=moved_start,
            duration=timedelta(hours=2), origin_date=original_start,
        )

        buckets = gather_time_buckets(self.start, self.start + timedelta(days=1))

        # Exactly one bucket for day one: the moved one, at 14:00 — the 09:00
        # occurrence is suppressed rather than regenerated alongside it.
        self.assertEqual(len(buckets), 1)
        self.assertEqual(buckets[0].start_date, moved_start)
        self.assertFalse(any(b.start_date == original_start for b in buckets))

    def test_unmoved_days_still_generate_normally(self):
        original = self._first_occurrence()
        moved_start = original.start_date.replace(hour=14)
        TimeBucket.objects.create(
            type=self.bucket_type, start_date=moved_start,
            duration=timedelta(hours=2), origin_date=original.start_date,
        )

        buckets = gather_time_buckets(self.start, self.start + timedelta(days=2))
        # Day one: the moved bucket. Day two: the untouched 09:00 occurrence.
        self.assertEqual(len(buckets), 2)
        day_two = [b for b in buckets if b.start_date.day == (self.start + timedelta(days=1)).day]
        self.assertEqual(len(day_two), 1)
        self.assertEqual(day_two[0].start_date.hour, 9)
