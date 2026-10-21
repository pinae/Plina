""""Doesn't fit within the planning horizon" says how much and why
(README: Task Dependencies and Alternative Plans): without a deadline it is
about the time buckets of the next 60 days, not about a date."""
from datetime import timedelta

from tasks.models import Tag, Task, TaskDependency, TimeBucketType
from tasks.tests.support import APIClient, TestCase


class UnplannedReasonTest(TestCase):
    def setUp(self):
        self.api = APIClient()
        # Two hours a day for 60 days: 120 hours.
        TimeBucketType.objects.create(name="Work", start_times="every day at 09:00", duration=timedelta(hours=2))

    def warnings(self):
        alternatives = self.api.post("/api/plan/alternatives/").json()["alternatives"]
        return {warning["header"]: warning for warning in alternatives[0]["warnings"]}

    def test_the_buckets_are_full(self):
        Task.objects.create(header="Huge", duration=timedelta(hours=130))
        warning = self.warnings()["Huge"]
        self.assertEqual(warning["kind"], "unplanned_within_horizon")
        self.assertIsNone(warning["deadline"])
        self.assertEqual(warning["missing_minutes"], 10 * 60)
        self.assertEqual((warning["waits_for"], warning["only_tags"]), (None, []))

    def test_only_its_own_buckets(self):
        evenings = Tag.objects.create(name="Freizeit")
        bucket = TimeBucketType.objects.create(name="Evening", start_times="every sunday at 19:00",
                                               duration=timedelta(hours=1))
        bucket.tags.add(evenings)
        book = Task.objects.create(header="Read the book", duration=timedelta(hours=12))
        book.tags.add(evenings)
        warning = self.warnings()["Read the book"]
        self.assertEqual(warning["only_tags"], ["Freizeit"])
        self.assertGreater(warning["missing_minutes"], 0)

    def test_waiting_for_a_task_that_does_not_fit(self):
        huge = Task.objects.create(header="Huge", duration=timedelta(hours=130), priority=9)
        text = Task.objects.create(header="Text überarbeiten", duration=timedelta(hours=2), priority=1)
        TaskDependency.objects.create(predecessor=huge, successor=text)
        warning = self.warnings()["Text überarbeiten"]
        self.assertEqual((warning["waits_for"], warning["missing_minutes"]), ("Huge", 120))
