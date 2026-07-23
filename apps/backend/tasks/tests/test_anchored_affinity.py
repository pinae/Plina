"""Regression: an anchored (fixed) task that splits across buckets must only
fill buckets whose affinity accepts it — not whatever bucket happens to be
chronologically next.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from tasks.models import Tag, Task, TimeBucket, TimeBucketType
from tasks.services.planner_service import allocate_tasks


class AnchoredAffinityTest(TestCase):
    def setUp(self):
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)
        self.tag_a = Tag.objects.create(name="a")
        self.tag_b = Tag.objects.create(name="b")
        self.type_a = TimeBucketType.objects.create(name="A", duration=timedelta(hours=4))
        self.type_a.tags.add(self.tag_a)
        self.type_b = TimeBucketType.objects.create(name="B", duration=timedelta(hours=4))
        self.type_b.tags.add(self.tag_b)

    def bucket(self, type_, hours_from_now, duration_hours):
        return TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=hours_from_now),
            duration=timedelta(hours=duration_hours), type=type_,
        )

    def _placed(self, plan, bucket, task):
        return sum((i.duration for i in plan[bucket.id] if i.task == task), timedelta(0))

    def test_anchored_split_skips_mismatched_buckets(self):
        b1 = self.bucket(self.type_a, 1, 2)   # tag a, only 2h
        b2 = self.bucket(self.type_b, 3, 4)   # tag b, chronologically next (mismatch)
        b3 = self.bucket(self.type_a, 8, 4)   # tag a, later
        anchored = Task.objects.create(
            header="Split", duration=timedelta(hours=6),
            start_date=self.now + timedelta(hours=1), is_fixed=True,
        )
        anchored.tags.add(self.tag_a)

        plan = allocate_tasks([b1, b2, b3], [anchored])

        # The 2h that fit in b1, the overflow skips the mismatched b2 and lands
        # in the next tag-a bucket b3 — never in b2.
        self.assertEqual(self._placed(plan, b1, anchored), timedelta(hours=2))
        self.assertEqual(self._placed(plan, b2, anchored), timedelta(0))
        self.assertEqual(self._placed(plan, b3, anchored), timedelta(hours=4))

    def test_untagged_bucket_still_accepts_overflow(self):
        # An untagged bucket accepts everything — affinity must not block it.
        general = TimeBucketType.objects.create(name="G", duration=timedelta(hours=4))
        b1 = self.bucket(self.type_a, 1, 2)
        b2 = TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=3), duration=timedelta(hours=4), type=general,
        )
        anchored = Task.objects.create(
            header="Split", duration=timedelta(hours=4),
            start_date=self.now + timedelta(hours=1), is_fixed=True,
        )
        anchored.tags.add(self.tag_a)

        plan = allocate_tasks([b1, b2], [anchored])

        self.assertEqual(self._placed(plan, b1, anchored), timedelta(hours=2))
        self.assertEqual(self._placed(plan, b2, anchored), timedelta(hours=2))
