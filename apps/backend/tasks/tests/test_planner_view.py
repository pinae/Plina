from datetime import timedelta

from django.conf import settings
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Task, TaskDependency, TimeBucketType


class PlannerViewTest(TestCase):
    """GET /api/plan/ over the full horizon with generated buckets."""

    def setUp(self):
        self.client = APIClient()
        TimeBucketType.objects.create(
            name="Daily Focus",
            start_times="every day at 09:00",
            duration=timedelta(hours=4),
        )

    def test_horizon_constant_exists(self):
        self.assertEqual(settings.PLANNING_HORIZON_DAYS, 60)

    def test_plan_includes_generated_buckets(self):
        response = self.client.get("/api/plan/")

        self.assertEqual(response.status_code, 200)
        buckets = response.data["buckets"]
        # ~60 daily occurrences generated from the type alone (none persisted).
        self.assertGreaterEqual(len(buckets), 55)
        for bucket in buckets[:3]:
            self.assertIn("id", bucket)
            self.assertIn("start_date", bucket)
            self.assertIn("end_date", bucket)
            self.assertIn("items", bucket)
        ids = [bucket["id"] for bucket in buckets]
        self.assertEqual(len(ids), len(set(ids)), "bucket ids must be unique")

    def test_plan_respects_dependencies_end_to_end(self):
        task_a = Task.objects.create(header="A", duration=timedelta(hours=1))
        task_b = Task.objects.create(
            header="B", duration=timedelta(hours=1),
            latest_finish_date=timezone.now() + timedelta(days=1),
        )
        TaskDependency.objects.create(predecessor=task_a, successor=task_b)

        response = self.client.get("/api/plan/")

        items = [
            item for bucket in response.data["buckets"] for item in bucket["items"]
        ]
        start_of = {item["header"]: item["start_time"] for item in items}
        self.assertIn("A", start_of)
        self.assertIn("B", start_of)
        self.assertLess(start_of["A"], start_of["B"])

    def test_appointments_are_reported_at_calendar_level(self):
        Task.objects.create(
            header="Doctor", duration=timedelta(hours=1),
            start_date=timezone.now() + timedelta(days=2),
            is_appointment=True,
        )

        response = self.client.get("/api/plan/")

        appointment_headers = [
            item["header"] for item in response.data["appointments"]
        ]
        self.assertEqual(appointment_headers, ["Doctor"])
