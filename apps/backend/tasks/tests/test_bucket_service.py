from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from tasks.models import TimeBucket, TimeBucketType
from tasks.services.bucket_service import gather_time_buckets


class GatherTimeBucketsTest(TestCase):
    def setUp(self):
        # A deterministic anchor: next Monday 00:00 local time.
        now = timezone.localtime()
        days_until_monday = (7 - now.weekday()) % 7 or 7
        self.monday = (now + timedelta(days=days_until_monday)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        self.bucket_type = TimeBucketType.objects.create(
            name="Morning Focus",
            start_times="every day at 09:00",
            duration=timedelta(hours=2),
        )

    def test_generates_buckets_from_types_over_horizon(self):
        buckets = gather_time_buckets(self.monday, self.monday + timedelta(days=3))

        self.assertEqual(len(buckets), 3)
        for bucket in buckets:
            self.assertEqual(bucket.start_date.astimezone(self.monday.tzinfo).hour, 9)
            self.assertEqual(bucket.type, self.bucket_type)

    def test_returns_buckets_sorted_by_start(self):
        buckets = gather_time_buckets(self.monday, self.monday + timedelta(days=5))
        starts = [b.start_date for b in buckets]
        self.assertEqual(starts, sorted(starts))

    def test_existing_db_buckets_suppress_overlapping_generated_ones(self):
        # Hand-placed bucket overlapping the generated Tuesday-09:00 slot.
        hand_placed = TimeBucket.objects.create(
            start_date=self.monday + timedelta(days=1, hours=8),
            duration=timedelta(hours=4),
            type=self.bucket_type,
        )

        buckets = gather_time_buckets(self.monday, self.monday + timedelta(days=3))

        self.assertEqual(len(buckets), 3)
        tuesday_buckets = [
            b for b in buckets
            if self.monday + timedelta(days=1) <= b.start_date < self.monday + timedelta(days=2)
        ]
        self.assertEqual(len(tuesday_buckets), 1)
        self.assertEqual(tuesday_buckets[0].id, hand_placed.id)

    def test_non_overlapping_db_buckets_are_included_alongside_generated(self):
        extra = TimeBucket.objects.create(
            start_date=self.monday + timedelta(hours=14),
            duration=timedelta(hours=2),
            type=self.bucket_type,
        )

        buckets = gather_time_buckets(self.monday, self.monday + timedelta(days=2))

        # 2 generated (Mon+Tue 09:00) + 1 hand-placed at Monday 14:00
        self.assertEqual(len(buckets), 3)
        self.assertIn(extra.id, [b.id for b in buckets if b.id is not None])

    def test_generated_buckets_are_not_persisted(self):
        gather_time_buckets(self.monday, self.monday + timedelta(days=3))
        self.assertEqual(TimeBucket.objects.count(), 0)


class CapacityWindowConversionTest(TestCase):
    def test_buckets_convert_to_pure_capacity_windows(self):
        from tasks.models import Tag
        from tasks.services.bucket_service import capacity_windows

        tag = Tag.objects.create(name="deep")
        bucket_type = TimeBucketType.objects.create(
            name="Deep", duration=timedelta(hours=2), start_times="every day at 09:00"
        )
        bucket_type.tags.add(tag)
        start = timezone.now() + timedelta(days=1)
        bucket = TimeBucket.objects.create(
            start_date=start, duration=timedelta(hours=2), type=bucket_type
        )

        windows = capacity_windows([bucket])

        self.assertEqual(len(windows), 1)
        self.assertEqual(windows[0].start, start)
        self.assertEqual(windows[0].end, start + timedelta(hours=2))
        self.assertEqual(windows[0].tag_ids, frozenset({tag.id}))


class UnparseableRecurrenceTest(TestCase):
    """Regression: types without a (valid) recurrence rule must simply
    generate no buckets instead of crashing the whole planner."""

    def test_empty_start_times_generates_nothing(self):
        bucket_type = TimeBucketType.objects.create(
            name="Manual only", duration=timedelta(hours=2)  # start_times=""
        )
        self.assertEqual(
            bucket_type.generate_buckets(generation_range=timedelta(days=7)), []
        )

    def test_garbage_start_times_generates_nothing(self):
        bucket_type = TimeBucketType.objects.create(
            name="Broken", start_times="blorp glorp", duration=timedelta(hours=2)
        )
        self.assertEqual(
            bucket_type.generate_buckets(generation_range=timedelta(days=7)), []
        )

    def test_gather_survives_a_mix_of_valid_and_invalid_types(self):
        TimeBucketType.objects.create(name="Manual only", duration=timedelta(hours=2))
        TimeBucketType.objects.create(
            name="Valid", start_times="every day at 09:00", duration=timedelta(hours=2)
        )
        now = timezone.now()
        buckets = gather_time_buckets(now, now + timedelta(days=3))
        self.assertGreaterEqual(len(buckets), 2)


class GenerateBucketsDefaultArgTest(TestCase):
    """Regression: `start: datetime = timezone.now()` as a default argument is
    evaluated once at import time and silently freezes the anchor date."""

    def test_default_start_is_evaluated_per_call(self):
        bucket_type = TimeBucketType.objects.create(
            name="Daily",
            start_times="every day at 09:00",
            duration=timedelta(hours=1),
        )
        buckets = bucket_type.generate_buckets(generation_range=timedelta(days=1))
        self.assertTrue(buckets)
        self.assertGreaterEqual(
            buckets[0].start_date, timezone.now() - timedelta(days=1)
        )
