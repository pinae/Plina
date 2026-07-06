from dataclasses import FrozenInstanceError
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from tasks.models import Tag, Task, TimeBucket, TimeBucketType
from tasks.services.planner_service import (
    PlanningTask,
    allocate_tasks,
    build_planning_tasks,
)


class PlanningTaskSnapshotTest(TestCase):
    """The planner must work on immutable snapshots, never on model instances."""

    def test_snapshot_carries_algorithmic_fields(self):
        tag = Tag.objects.create(name="coding")
        deadline = timezone.now() + timedelta(days=1)
        task = Task.objects.create(
            header="Snapshot me",
            duration=timedelta(hours=2),
            latest_finish_date=deadline,
            priority=7.0,
        )
        task.tags.add(tag)

        snapshot = PlanningTask.from_task(task)

        self.assertEqual(snapshot.id, task.id)
        self.assertEqual(snapshot.header, "Snapshot me")
        self.assertEqual(snapshot.priority, 7.0)
        self.assertEqual(snapshot.latest_finish_date, deadline)
        self.assertEqual(snapshot.tag_ids, frozenset({tag.id}))
        self.assertIs(snapshot.source, task)

    def test_snapshot_is_immutable(self):
        task = Task.objects.create(header="Frozen", duration=timedelta(hours=1))
        snapshot = PlanningTask.from_task(task)
        with self.assertRaises(FrozenInstanceError):
            snapshot.priority = 99.0

    def test_remaining_duration_subtracts_time_spent(self):
        task = Task.objects.create(
            header="Half done",
            duration=timedelta(hours=2),
            time_spent=timedelta(minutes=30),
        )
        snapshot = PlanningTask.from_task(task)
        self.assertEqual(snapshot.remaining_duration, timedelta(hours=1, minutes=30))

    def test_remaining_duration_never_negative(self):
        task = Task.objects.create(
            header="Overrun",
            duration=timedelta(hours=1),
            time_spent=timedelta(hours=3),
        )
        snapshot = PlanningTask.from_task(task)
        self.assertEqual(snapshot.remaining_duration, timedelta(0))

    def test_missing_duration_falls_back_to_default_estimate(self):
        task = Task.objects.create(header="Unestimated")
        snapshot = PlanningTask.from_task(task)
        self.assertEqual(snapshot.remaining_duration, timedelta(hours=1))


class BuildPlanningTasksTest(TestCase):
    def test_excludes_completed_tasks(self):
        open_task = Task.objects.create(header="Open", duration=timedelta(hours=1))
        Task.objects.create(
            header="Done", duration=timedelta(hours=1), completed_at=timezone.now()
        )

        snapshots = build_planning_tasks(Task.objects.all())

        self.assertEqual([s.id for s in snapshots], [open_task.id])

    def test_excludes_tasks_without_remaining_work(self):
        Task.objects.create(
            header="Fully logged",
            duration=timedelta(hours=1),
            time_spent=timedelta(hours=1),
        )
        snapshots = build_planning_tasks(Task.objects.all())
        self.assertEqual(snapshots, [])


class AllocationImmutabilityTest(TestCase):
    """allocate_tasks must not write to Task model instances (README rule)."""

    def setUp(self):
        self.now = timezone.now()
        self.bucket_type = TimeBucketType.objects.create(name="General")
        self.bucket = TimeBucket.objects.create(
            start_date=self.now, duration=timedelta(hours=1), type=self.bucket_type
        )

    def test_partially_scheduled_task_keeps_its_duration(self):
        task = Task.objects.create(header="Long", duration=timedelta(hours=3))

        allocate_tasks([self.bucket], [task])

        self.assertEqual(task.duration, timedelta(hours=3))
        task.refresh_from_db()
        self.assertEqual(task.duration, timedelta(hours=3))

    def test_allocation_accounts_for_time_spent(self):
        task = Task.objects.create(
            header="Almost finished",
            duration=timedelta(hours=2),
            time_spent=timedelta(hours=1, minutes=30),
        )

        plan = allocate_tasks([self.bucket], [task])

        items = plan[self.bucket.id]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].duration, timedelta(minutes=30))

    def test_completed_tasks_are_never_allocated(self):
        Task.objects.create(
            header="Already done",
            duration=timedelta(hours=1),
            completed_at=timezone.now(),
        )

        plan = allocate_tasks([self.bucket], list(Task.objects.all()))

        self.assertEqual(plan[self.bucket.id], [])
