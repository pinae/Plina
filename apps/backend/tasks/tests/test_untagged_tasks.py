"""Tasks without tags may be planned into any bucket, as if they had every tag.

No tags usually means the user has not sorted the task yet — not that it fits
nowhere. Before, such a task only fitted untagged buckets, so with tagged
bucket types alone it was never planned.
"""
from datetime import timedelta

from django.test import TestCase
from rest_framework.test import APIClient

from tasks.models import Tag, Task, TimeBucketType


class UntaggedTasksArePlannedAnywhereTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        deep = Tag.objects.create(name="deep-work")
        self.meeting = Tag.objects.create(name="meeting")
        # Only tagged buckets exist.
        focus = TimeBucketType.objects.create(
            name="Focus", start_times="every day at 09:00", duration=timedelta(hours=4))
        focus.tags.add(deep)

    def planned_headers(self):
        response = self.client.get("/api/plan/")
        self.assertEqual(response.status_code, 200)
        return {item["header"] for bucket in response.data["buckets"] for item in bucket["items"]}

    def test_an_untagged_task_lands_in_a_tagged_bucket(self):
        Task.objects.create(header="Call landlord", duration=timedelta(hours=1))
        self.assertIn("Call landlord", self.planned_headers())

    def test_a_task_with_other_tags_still_does_not(self):
        standup = Task.objects.create(header="Prepare standup", duration=timedelta(hours=1))
        standup.tags.add(self.meeting)
        self.assertNotIn("Prepare standup", self.planned_headers())

    def test_the_rest_of_an_untagged_parent_is_planned_too(self):
        parent = Task.objects.create(header="Garden shed", duration=timedelta(hours=3))
        Task.objects.create(header="Buy wood", parent=parent, duration=timedelta(hours=1))
        self.assertTrue({"Buy wood", "Rest of Garden shed"} <= self.planned_headers())

    def test_no_unplanned_warning_for_the_untagged_task(self):
        Task.objects.create(header="Call landlord", duration=timedelta(hours=1))
        standup = Task.objects.create(header="Prepare standup", duration=timedelta(hours=1))
        standup.tags.add(self.meeting)
        response = self.client.post("/api/plan/alternatives/")
        self.assertEqual(response.status_code, 200)
        unplanned = {w["header"] for w in response.data["alternatives"][0]["warnings"]
                     if w["kind"] == "unplanned_within_horizon"}
        self.assertEqual(unplanned, {"Prepare standup"})
