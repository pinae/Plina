from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Plan, Task, TaskDependency, TimeBucket, TimeBucketType


class ManualPlacementFixture(TestCase):
    """Accepted plan over A -> B; manual drags of B must respect A's slot."""

    def setUp(self):
        self.client = APIClient()
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)
        TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=4),
        )
        self.task_a = Task.objects.create(header="A", duration=timedelta(hours=2))
        self.task_b = Task.objects.create(header="B", duration=timedelta(hours=1))
        TaskDependency.objects.create(predecessor=self.task_a, successor=self.task_b)
        alternatives = self.client.post("/api/plan/alternatives/").data["alternatives"]
        self.client.post(f"/api/plans/{alternatives[0]['id']}/accept/")
        self.plan = Plan.objects.get(is_accepted=True)
        entry = self.plan.entries.filter(task=self.task_a).order_by("-start").first()
        self.a_end = entry.start + entry.duration

    def place(self, task, start):
        return self.client.patch(
            f"/api/tasks/{task.id}/",
            {"start_date": start.isoformat(), "is_fixed": True},
            format="json",
        )


class ManualPlacementValidationTest(ManualPlacementFixture):
    def test_placing_a_successor_before_its_predecessor_is_rejected(self):
        response = self.place(self.task_b, self.a_end - timedelta(minutes=30))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["predecessor"]["header"], "A")
        self.assertIn("available_from", response.data)
        self.task_b.refresh_from_db()
        self.assertFalse(self.task_b.is_fixed)  # nothing was written

    def test_placing_after_the_predecessors_planned_end_is_allowed(self):
        response = self.place(self.task_b, self.a_end + timedelta(minutes=15))

        self.assertEqual(response.status_code, 200)
        self.task_b.refresh_from_db()
        self.assertTrue(self.task_b.is_fixed)

    def test_completed_predecessors_do_not_block_placement(self):
        self.task_a.completed_at = timezone.now()
        self.task_a.save()

        response = self.place(self.task_b, self.now + timedelta(hours=1))

        self.assertEqual(response.status_code, 200)

    def test_placement_without_an_accepted_plan_is_permissive(self):
        Plan.objects.all().delete()
        response = self.place(self.task_b, self.now + timedelta(hours=1))
        self.assertEqual(response.status_code, 200)


class RecalculationTriggerTest(TestCase):
    """A7: schedule-relevant mutations trigger a recalculation."""

    def setUp(self):
        self.client = APIClient()
        self.task = Task.objects.create(header="T", duration=timedelta(hours=1))
        self.bucket_type = TimeBucketType.objects.create(
            name="Manual", duration=timedelta(hours=2)
        )

    def assert_triggers(self, action, times=1):
        with patch("tasks.api.recalculate_accepted_plan") as recalc:
            action()
        self.assertEqual(recalc.call_count, times)

    def test_task_update_triggers_recalculation(self):
        self.assert_triggers(lambda: self.client.patch(
            f"/api/tasks/{self.task.id}/", {"priority": 9.0}, format="json",
        ))

    def test_task_create_and_delete_trigger_recalculation(self):
        self.assert_triggers(lambda: self.client.post(
            "/api/tasks/", {"header": "New"}, format="json",
        ))
        self.assert_triggers(lambda: self.client.delete(f"/api/tasks/{self.task.id}/"))

    def test_dependency_create_and_delete_trigger_recalculation(self):
        other = Task.objects.create(header="Other", duration=timedelta(hours=1))
        created = {}

        def create():
            response = self.client.post(
                "/api/dependencies/",
                {"predecessor": str(self.task.id), "successor": str(other.id)},
                format="json",
            )
            created["id"] = response.data["id"]

        self.assert_triggers(create)
        self.assert_triggers(
            lambda: self.client.delete(f"/api/dependencies/{created['id']}/")
        )

    def test_bucket_create_and_update_trigger_recalculation(self):
        created = {}

        def create():
            response = self.client.post("/api/timebuckets/", {
                "start_date": timezone.now().isoformat(),
                "duration": "02:00:00",
                "type_id": self.bucket_type.id,
            }, format="json")
            created["id"] = response.data["id"]

        self.assert_triggers(create)
        self.assert_triggers(lambda: self.client.patch(
            f"/api/timebuckets/{created['id']}/", {"duration": "03:00:00"},
            format="json",
        ))


class BucketMaterializationTest(TestCase):
    """A8: editing a generated (unsaved) bucket materializes it — the client
    POSTs with the bucket's pre-assigned UUID."""

    def setUp(self):
        self.client = APIClient()
        self.bucket_type = TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=4),
        )

    def test_post_with_explicit_id_creates_that_bucket(self):
        bucket_id = uuid4()
        response = self.client.post("/api/timebuckets/", {
            "id": str(bucket_id),
            "start_date": (timezone.now() + timedelta(days=1)).isoformat(),
            "duration": "04:00:00",
            "type_id": self.bucket_type.id,
        }, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(TimeBucket.objects.filter(id=bucket_id).exists())

    def test_plan_payload_marks_bucket_persistence(self):
        # Fallback (no accepted plan): generated buckets are not persisted.
        response = self.client.get("/api/plan/")
        buckets = response.data["buckets"]
        self.assertTrue(buckets)
        self.assertTrue(all(bucket["persisted"] is False for bucket in buckets))
        self.assertTrue(all(bucket["type_id"] == self.bucket_type.id for bucket in buckets))

        saved = TimeBucket.objects.create(
            start_date=timezone.now() + timedelta(hours=1),
            duration=timedelta(hours=2), type=self.bucket_type,
        )
        response = self.client.get("/api/plan/")
        persisted_flags = {
            bucket["id"]: bucket["persisted"] for bucket in response.data["buckets"]
        }
        self.assertTrue(persisted_flags[saved.id])
