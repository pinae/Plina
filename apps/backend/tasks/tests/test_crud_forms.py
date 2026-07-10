from datetime import timedelta

from django.test import TestCase
from rest_framework.test import APIClient

from tasks.models import Project, Tag, Task, TimeBucketType


class RecurrencePreviewTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def preview(self, start_times):
        return self.client.post(
            "/api/recurrence-preview/", {"start_times": start_times}, format="json",
        )

    def test_valid_rule_returns_five_upcoming_occurrences(self):
        response = self.preview("every day at 09:00")

        self.assertEqual(response.status_code, 200)
        occurrences = response.data["occurrences"]
        self.assertEqual(len(occurrences), 5)
        self.assertEqual(occurrences, sorted(occurrences))
        self.assertTrue(all("09:00" in occ for occ in occurrences))

    def test_unparseable_rule_returns_the_parser_error(self):
        response = self.preview("blorp glorp")
        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.data)

    def test_empty_rule_is_rejected(self):
        response = self.preview("")
        self.assertEqual(response.status_code, 400)


class TaskProjectAssignmentTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.project_a = Project.objects.create(name="A")
        self.project_b = Project.objects.create(name="B")

    def test_create_task_with_project(self):
        response = self.client.post("/api/tasks/", {
            "header": "In A", "project_id": str(self.project_a.id),
        }, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["project_id"], self.project_a.id)
        task = Task.objects.get(id=response.data["id"])
        self.assertEqual(task.project, self.project_a)

    def test_move_task_between_projects(self):
        task = Task.objects.create(header="Mover")
        self.project_a.add(task)

        response = self.client.patch(
            f"/api/tasks/{task.id}/", {"project_id": str(self.project_b.id)},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.project, self.project_b)
        self.assertEqual(self.project_a.tasks, [])

    def test_clear_project_with_null(self):
        task = Task.objects.create(header="Loner")
        self.project_a.add(task)

        response = self.client.patch(
            f"/api/tasks/{task.id}/", {"project_id": None}, format="json",
        )

        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertIsNone(task.project)


class TagColorTest(TestCase):
    def test_create_tag_with_hex_color(self):
        response = APIClient().post("/api/tags/", {
            "name": "deep", "hex_color": "#3357ff",
        }, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["hex_color"], "#3357ff")
        self.assertEqual(Tag.objects.get(name="deep").color, b"\x33\x57\xff")

    def test_invalid_hex_color_is_rejected(self):
        response = APIClient().post("/api/tags/", {
            "name": "bad", "hex_color": "chartreuse",
        }, format="json")
        self.assertEqual(response.status_code, 400)


class BucketTypeRouteTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_bucket_type_with_tags(self):
        tag = Tag.objects.create(name="deep")
        response = self.client.post("/api/buckettypes/", {
            "name": "Morning Focus",
            "start_times": "every weekday at 09:00",
            "duration": "04:00:00",
            "tag_ids": [str(tag.id)],
        }, format="json")

        self.assertEqual(response.status_code, 201)
        bucket_type = TimeBucketType.objects.get(name="Morning Focus")
        self.assertEqual(bucket_type.duration, timedelta(hours=4))
        self.assertEqual(list(bucket_type.tags.all()), [tag])

    def test_list_bucket_types(self):
        TimeBucketType.objects.create(name="X", duration=timedelta(hours=1))
        response = self.client.get("/api/buckettypes/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)


class ProjectTagsWriteTest(TestCase):
    def test_create_project_with_tags(self):
        tag = Tag.objects.create(name="client")
        response = APIClient().post("/api/projects/", {
            "name": "Webshop", "priority": 8.0, "tag_ids": [str(tag.id)],
        }, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(list(Project.objects.get(name="Webshop").tags.all()), [tag])


class GeneratedTimesAreCleanTest(TestCase):
    """Regression: rrule occurrences inherited seconds/microseconds from the
    generation anchor (buckets at 09:00:40 instead of 09:00:00)."""

    def test_generated_buckets_start_on_the_minute(self):
        bucket_type = TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=1),
        )
        buckets = bucket_type.generate_buckets(generation_range=timedelta(days=3))
        self.assertTrue(buckets)
        for bucket in buckets:
            self.assertEqual((bucket.start_date.second, bucket.start_date.microsecond), (0, 0))
