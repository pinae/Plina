from datetime import timedelta
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone

from tasks.models import Tag, Task, TimeBucket, TimeBucketType
from tasks.services.planner_service import allocate_tasks, rank_tasks


def first_start(plan, bucket_id, task):
    items = [item for item in plan[bucket_id] if item.task == task]
    return min(item.start_time for item in items) if items else None


class DependencyAwareAllocationTest(TestCase):
    """Finish-to-start: a successor may only run after its predecessor's
    remaining duration has been fully allocated."""

    def setUp(self):
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)
        self.bucket_type = TimeBucketType.objects.create(
            name="General", duration=timedelta(hours=4)
        )

    def bucket(self, hours_from_now: float, duration_hours: float = 4) -> TimeBucket:
        return TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=hours_from_now),
            duration=timedelta(hours=duration_hours),
            type=self.bucket_type,
        )

    def test_successor_runs_after_predecessor_within_one_bucket(self):
        bucket = self.bucket(1)
        task_a = Task.objects.create(header="A", duration=timedelta(hours=1))
        task_b = Task.objects.create(header="B", duration=timedelta(hours=1))

        plan = allocate_tasks([bucket], [task_b, task_a], edges=[(task_a.id, task_b.id)])

        start_a = first_start(plan, bucket.id, task_a)
        start_b = first_start(plan, bucket.id, task_b)
        self.assertIsNotNone(start_b)
        self.assertEqual(start_b, start_a + timedelta(hours=1))

    def test_chain_splits_across_buckets_in_order(self):
        bucket1, bucket2, bucket3 = self.bucket(1, 2), self.bucket(24, 2), self.bucket(48, 2)
        task_a = Task.objects.create(header="A", duration=timedelta(hours=3))
        task_b = Task.objects.create(header="B", duration=timedelta(hours=2))

        plan = allocate_tasks(
            [bucket1, bucket2, bucket3], [task_a, task_b],
            edges=[(task_a.id, task_b.id)],
        )

        # A: 2h in bucket1 + 1h in bucket2; B: 1h in bucket2 + 1h in bucket3.
        self.assertEqual(sum((i.duration for i in plan[bucket1.id] if i.task == task_a), timedelta(0)),
                         timedelta(hours=2))
        self.assertEqual(first_start(plan, bucket2.id, task_b),
                         bucket2.start_date + timedelta(hours=1))
        self.assertEqual(sum((i.duration for i in plan[bucket3.id] if i.task == task_b), timedelta(0)),
                         timedelta(hours=1))

    def test_ranking_cannot_override_dependencies(self):
        """B ranks first (urgent deadline) but depends on A: A must still run first."""
        bucket = self.bucket(1)
        task_a = Task.objects.create(header="A", duration=timedelta(hours=1))
        task_b = Task.objects.create(
            header="B", duration=timedelta(hours=1),
            latest_finish_date=self.now + timedelta(hours=3),
        )
        ranked = rank_tasks([task_b, task_a], self.now)
        self.assertEqual(ranked[0], task_b)  # sanity: ranking alone would pick B

        plan = allocate_tasks([bucket], ranked, edges=[(task_a.id, task_b.id)])

        self.assertEqual(first_start(plan, bucket.id, task_a), bucket.start_date)
        self.assertEqual(first_start(plan, bucket.id, task_b),
                         bucket.start_date + timedelta(hours=1))

    def test_edge_from_completed_predecessor_is_satisfied(self):
        bucket = self.bucket(1)
        done = Task.objects.create(
            header="Done", duration=timedelta(hours=1), completed_at=timezone.now()
        )
        task_b = Task.objects.create(header="B", duration=timedelta(hours=1))

        plan = allocate_tasks([bucket], [done, task_b], edges=[(done.id, task_b.id)])

        self.assertEqual(first_start(plan, bucket.id, task_b), bucket.start_date)

    def test_edge_from_unknown_task_id_is_satisfied(self):
        bucket = self.bucket(1)
        task_b = Task.objects.create(header="B", duration=timedelta(hours=1))

        plan = allocate_tasks([bucket], [task_b], edges=[(uuid4(), task_b.id)])

        self.assertEqual(first_start(plan, bucket.id, task_b), bucket.start_date)

    def test_successor_of_unallocatable_predecessor_stays_unplanned(self):
        """A only fits #deep buckets, none exist -> B must not jump the queue."""
        bucket = self.bucket(1)
        deep = Tag.objects.create(name="deep")
        task_a = Task.objects.create(header="A", duration=timedelta(hours=1))
        task_a.tags.add(deep)
        general_type = TimeBucketType.objects.create(
            name="Tagged", duration=timedelta(hours=4)
        )
        general_type.tags.add(Tag.objects.create(name="other"))
        bucket.type = general_type
        bucket.save()
        task_b = Task.objects.create(header="B", duration=timedelta(hours=1))

        plan = allocate_tasks([bucket], [task_a, task_b], edges=[(task_a.id, task_b.id)])

        self.assertIsNone(first_start(plan, bucket.id, task_a))
        self.assertIsNone(first_start(plan, bucket.id, task_b))
