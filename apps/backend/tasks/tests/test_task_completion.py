from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Task


class TaskCompletionModelTest(TestCase):
    def test_new_task_is_not_done(self):
        task = Task.objects.create(header="Fresh Task")
        self.assertIsNone(task.completed_at)
        self.assertFalse(task.is_done)

    def test_task_with_completed_at_is_done(self):
        task = Task.objects.create(header="Old Task", completed_at=timezone.now())
        self.assertTrue(task.is_done)


class TaskCompletionApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.task = Task.objects.create(
            header="API Task", duration=timedelta(hours=1)
        )

    def test_serializer_exposes_completion_fields(self):
        response = self.client.get(f"/api/tasks/{self.task.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("completed_at", response.data)
        self.assertIn("is_done", response.data)
        self.assertIsNone(response.data["completed_at"])
        self.assertFalse(response.data["is_done"])

    def test_completing_a_task_via_patch(self):
        now = timezone.now()
        response = self.client.patch(
            f"/api/tasks/{self.task.id}/",
            {"completed_at": now.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.task.refresh_from_db()
        self.assertTrue(self.task.is_done)

    def test_is_done_is_read_only(self):
        response = self.client.patch(
            f"/api/tasks/{self.task.id}/",
            {"is_done": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.task.refresh_from_db()
        self.assertFalse(self.task.is_done)
