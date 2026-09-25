"""Task write validation.

Regression: a task with an empty description could not be saved — the model's
TextField had no ``blank=True``, so DRF rejected ``description: ""`` with
"This field may not be blank." The description is optional.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from tasks.models import Task


class TaskDescriptionOptionalTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_task_with_empty_description_can_be_created(self):
        response = self.client.post("/api/tasks/", {
            "header": "No description", "description": "", "duration": "01:00:00",
        }, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Task.objects.get(header="No description").description, "")

    def test_description_can_be_cleared_on_edit(self):
        task = Task.objects.create(header="T", description="old")
        response = self.client.patch(
            f"/api/tasks/{task.id}/", {"description": ""}, format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.description, "")

    def test_project_with_empty_description_can_be_created(self):
        # Same bug on Project: the project form also sends description "".
        response = self.client.post("/api/projects/", {
            "name": "No description", "description": "",
        }, format="json")

        self.assertEqual(response.status_code, 201, response.data)

    def test_empty_header_is_still_rejected_with_a_field_error(self):
        response = self.client.post("/api/tasks/", {"header": ""}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("header", response.data)
