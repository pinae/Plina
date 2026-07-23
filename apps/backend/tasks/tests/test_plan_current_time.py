"""Regression: planning must be able to use a free bucket at the current time.

A bucket that is ongoing right now (started earlier, ends later) was excluded
entirely, so "Plan my week" skipped the current time and only used later
buckets. Buckets are now offered from the current time onward, clamped so
nothing is scheduled in the past, and tasks fill the earliest one first.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from tasks.models import Task, TimeBucket, TimeBucketType
from tasks.services.bucket_service import gather_time_buckets
from tasks.services.planner_service import allocate_tasks


class PlanCurrentTimeTest(TestCase):
    def setUp(self):
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)
        self.type = TimeBucketType.objects.create(name="G", duration=timedelta(hours=4))

    def test_ongoing_bucket_is_offered_clamped_to_now(self):
        # Started an hour ago, ends in three hours — still usable now.
        TimeBucket.objects.create(
            start_date=self.now - timedelta(hours=1), duration=timedelta(hours=4), type=self.type,
        )
        buckets = gather_time_buckets(self.now, self.now + timedelta(days=1))
        self.assertEqual(len(buckets), 1)
        # Usable window starts at now, keeps the real end.
        self.assertEqual(buckets[0].start_date, self.now)
        self.assertEqual(buckets[0].end_date, self.now + timedelta(hours=3))

    def test_task_is_planned_into_the_earliest_free_bucket(self):
        early = TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=1), duration=timedelta(hours=2), type=self.type,
        )
        late = TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=10), duration=timedelta(hours=2), type=self.type,
        )
        task = Task.objects.create(header="T", duration=timedelta(hours=1))

        plan = allocate_tasks([early, late], [task])

        self.assertEqual([i.task for i in plan[early.id]], [task])
        self.assertEqual(plan[late.id], [])

    def test_a_long_task_fills_the_earlier_bucket_then_the_later_one(self):
        early = TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=1), duration=timedelta(hours=2), type=self.type,
        )
        late = TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=10), duration=timedelta(hours=4), type=self.type,
        )
        task = Task.objects.create(header="Big", duration=timedelta(hours=3))

        plan = allocate_tasks([early, late], [task])

        early_min = sum((i.duration for i in plan[early.id] if i.task == task), timedelta(0))
        late_min = sum((i.duration for i in plan[late.id] if i.task == task), timedelta(0))
        self.assertEqual(early_min, timedelta(hours=2))  # earlier bucket filled first
        self.assertEqual(late_min, timedelta(hours=1))   # overflow into the later one

    def test_task_can_be_planned_at_the_current_time_via_an_ongoing_bucket(self):
        TimeBucket.objects.create(
            start_date=self.now - timedelta(hours=1), duration=timedelta(hours=4), type=self.type,
        )
        task = Task.objects.create(header="Now", duration=timedelta(hours=1))

        buckets = gather_time_buckets(self.now, self.now + timedelta(days=1))
        plan = allocate_tasks(buckets, [task])

        items = [i for entries in plan.values() for i in entries if i.task == task]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].start_time, self.now)  # scheduled starting now
