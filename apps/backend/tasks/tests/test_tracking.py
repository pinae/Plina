from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import (Plan, Task, TaskDependency, TimeBucketType,
                          TrackingSession)
from tasks.services.tracking import (AnotherSessionOpen, TrackingError,
                                     UnfinishedPredecessors, complete_task,
                                     start_tracking, stop_tracking)


class TrackingServiceTest(TestCase):
    """Exact-time tests: services accept explicit ``now`` for determinism."""

    def setUp(self):
        self.now = timezone.now().replace(microsecond=0)
        self.task = Task.objects.create(header="Work", duration=timedelta(hours=2))

    def test_start_opens_session_and_anchors_the_task(self):
        session = start_tracking(self.task, now=self.now)

        self.task.refresh_from_db()
        self.assertTrue(self.task.is_fixed)
        self.assertEqual(self.task.start_date, self.now)
        self.assertEqual(session.start, self.now)
        self.assertIsNone(session.end)

    def test_stop_adds_exact_elapsed_time_to_time_spent(self):
        start_tracking(self.task, now=self.now)
        elapsed = timedelta(minutes=37)

        session = stop_tracking(self.task, now=self.now + elapsed)

        self.task.refresh_from_db()
        self.assertEqual(self.task.time_spent, elapsed)
        self.assertEqual(session.end, self.now + elapsed)

    def test_consecutive_sessions_accumulate(self):
        start_tracking(self.task, now=self.now)
        stop_tracking(self.task, now=self.now + timedelta(minutes=10))
        start_tracking(self.task, now=self.now + timedelta(hours=1))
        stop_tracking(self.task, now=self.now + timedelta(hours=1, minutes=5))

        self.task.refresh_from_db()
        self.assertEqual(self.task.time_spent, timedelta(minutes=15))

    def test_second_start_while_any_session_is_open_is_rejected(self):
        other = Task.objects.create(header="Other", duration=timedelta(hours=1))
        start_tracking(other, now=self.now)

        with self.assertRaises(AnotherSessionOpen):
            start_tracking(self.task, now=self.now + timedelta(minutes=1))

    def test_start_with_unfinished_predecessor_is_rejected_naming_it(self):
        blocker = Task.objects.create(header="Blocker", duration=timedelta(hours=1))
        TaskDependency.objects.create(predecessor=blocker, successor=self.task)

        with self.assertRaises(UnfinishedPredecessors) as ctx:
            start_tracking(self.task, now=self.now)

        named = [pred["header"] for pred in ctx.exception.payload["predecessors"]]
        self.assertEqual(named, ["Blocker"])
        self.assertFalse(TrackingSession.objects.exists())

    def test_start_after_predecessor_completed_is_allowed(self):
        blocker = Task.objects.create(
            header="Blocker", duration=timedelta(hours=1),
            completed_at=self.now - timedelta(hours=1),
        )
        TaskDependency.objects.create(predecessor=blocker, successor=self.task)

        session = start_tracking(self.task, now=self.now)
        self.assertIsNotNone(session)

    def test_start_on_completed_task_is_rejected(self):
        self.task.completed_at = self.now
        self.task.save()
        with self.assertRaises(TrackingError):
            start_tracking(self.task, now=self.now)

    def test_stop_without_open_session_is_rejected(self):
        with self.assertRaises(TrackingError):
            stop_tracking(self.task, now=self.now)

    def test_complete_closes_open_session_and_sets_completed_at(self):
        start_tracking(self.task, now=self.now)

        complete_task(self.task, now=self.now + timedelta(minutes=20))

        self.task.refresh_from_db()
        self.assertEqual(self.task.completed_at, self.now + timedelta(minutes=20))
        self.assertEqual(self.task.time_spent, timedelta(minutes=20))
        self.assertFalse(TrackingSession.objects.filter(end=None).exists())

    def test_complete_twice_is_rejected(self):
        complete_task(self.task, now=self.now)
        with self.assertRaises(TrackingError):
            complete_task(self.task, now=self.now)


class TrackingApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.task = Task.objects.create(header="Work", duration=timedelta(hours=2))

    def test_start_endpoint_anchors_and_returns_the_task(self):
        response = self.client.post(f"/api/tasks/{self.task.id}/track/start/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["task"]["is_fixed"])
        self.assertIsNotNone(response.data["task"]["active_tracking_start"])

    def test_start_conflict_returns_409(self):
        other = Task.objects.create(header="Other", duration=timedelta(hours=1))
        self.client.post(f"/api/tasks/{other.id}/track/start/")

        response = self.client.post(f"/api/tasks/{self.task.id}/track/start/")

        self.assertEqual(response.status_code, 409)

    def test_start_blocked_by_predecessor_returns_400_naming_it(self):
        blocker = Task.objects.create(header="Blocker", duration=timedelta(hours=1))
        TaskDependency.objects.create(predecessor=blocker, successor=self.task)

        response = self.client.post(f"/api/tasks/{self.task.id}/track/start/")

        self.assertEqual(response.status_code, 400)
        named = [pred["header"] for pred in response.data["predecessors"]]
        self.assertEqual(named, ["Blocker"])

    @patch("tasks.services.tracking.recalculate_accepted_plan")
    def test_stop_updates_time_spent_and_triggers_recalculation(self, recalc):
        self.client.post(f"/api/tasks/{self.task.id}/track/start/")

        response = self.client.post(f"/api/tasks/{self.task.id}/track/stop/")

        self.assertEqual(response.status_code, 200)
        self.task.refresh_from_db()
        self.assertGreaterEqual(self.task.time_spent, timedelta(0))
        self.assertIsNone(response.data["task"]["active_tracking_start"])
        recalc.assert_called_once()

    def test_stop_without_session_returns_400(self):
        response = self.client.post(f"/api/tasks/{self.task.id}/track/stop/")
        self.assertEqual(response.status_code, 400)


class CompletionChoicesTest(TestCase):
    """Completing a task recalculates and, when the new frontier offers a real
    choice (>= 2 branches), embeds freshly stored alternatives."""

    def setUp(self):
        self.client = APIClient()
        TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=4),
        )
        self.root = Task.objects.create(header="Root", duration=timedelta(hours=1))
        self.left = Task.objects.create(header="Left", duration=timedelta(hours=1))
        self.right = Task.objects.create(header="Right", duration=timedelta(hours=1))
        self.merge = Task.objects.create(header="Merge", duration=timedelta(hours=1))
        for predecessor, successor in [(self.root, self.left), (self.root, self.right),
                                       (self.left, self.merge), (self.right, self.merge)]:
            TaskDependency.objects.create(predecessor=predecessor, successor=successor)

    def test_completing_a_diamond_root_returns_choices(self):
        response = self.client.post(f"/api/tasks/{self.root.id}/complete/")

        self.assertEqual(response.status_code, 200)
        self.root.refresh_from_db()
        self.assertTrue(self.root.is_done)
        alternatives = response.data["alternatives"]
        self.assertGreaterEqual(len(alternatives), 2)
        first_tasks = set()
        for alternative in alternatives:
            self.assertIn("id", alternative)
            items = [i for b in alternative["buckets"] for i in b["items"]]
            first_tasks.add(min(items, key=lambda i: i["start_time"])["header"])
        self.assertEqual(first_tasks, {"Left", "Right"})
        # Choices are stored as candidates so the user can accept one.
        self.assertEqual(
            Plan.objects.filter(is_accepted=False).count(), len(alternatives)
        )

    def test_completing_with_a_single_branch_returns_no_choices(self):
        # Finish everything except the strict tail Left -> Merge.
        for task in (self.root, self.right):
            task.completed_at = timezone.now()
            task.save()

        response = self.client.post(f"/api/tasks/{self.left.id}/complete/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["alternatives"], [])

    def test_completing_an_already_completed_task_returns_400(self):
        self.client.post(f"/api/tasks/{self.root.id}/complete/")
        response = self.client.post(f"/api/tasks/{self.root.id}/complete/")
        self.assertEqual(response.status_code, 400)

    def test_completion_removes_the_tasks_fluid_entries_from_the_accepted_plan(self):
        alternatives = self.client.post("/api/plan/alternatives/").data["alternatives"]
        self.client.post(f"/api/plans/{alternatives[0]['id']}/accept/")
        accepted = Plan.objects.get(is_accepted=True)
        self.assertTrue(accepted.entries.filter(task=self.root).exists())

        self.client.post(f"/api/tasks/{self.root.id}/complete/")

        self.assertFalse(accepted.entries.filter(task=self.root).exists())
