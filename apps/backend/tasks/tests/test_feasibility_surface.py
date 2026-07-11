from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Plan, Project, Task, TaskDependency, TimeBucketType


class PlanWarningsPayloadTest(TestCase):
    """WP-13: the accepted plan's stored warnings surface in GET /api/plan/."""

    def setUp(self):
        self.client = APIClient()
        TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=2),
        )

    def test_accepted_plan_exposes_feasibility_warnings(self):
        Task.objects.create(
            header="Rush job", duration=timedelta(hours=30),
            latest_finish_date=timezone.now() + timedelta(days=2),
        )
        alternatives = self.client.post("/api/plan/alternatives/").data["alternatives"]
        self.client.post(f"/api/plans/{alternatives[0]['id']}/accept/")

        response = self.client.get("/api/plan/")

        warnings = response.data["warnings"]
        self.assertTrue(warnings)
        self.assertEqual(warnings[0]["kind"], "deadline_missed")
        self.assertEqual(warnings[0]["header"], "Rush job")

    def test_fallback_payload_has_an_empty_warning_list(self):
        response = self.client.get("/api/plan/")
        self.assertEqual(response.data["warnings"], [])


class MaraDemoDataTest(TestCase):
    """The demo data must set the stage for the §3 user-story walkthrough."""

    def setUp(self):
        call_command("populate_demo_data", verbosity=0)

    def test_two_projects_with_the_story_names(self):
        names = set(Project.objects.values_list("name", flat=True))
        self.assertEqual(names, {"Webshop Relaunch", "Company Blog"})

    def test_webshop_chain_and_blog_dependency_exist(self):
        by_header = {task.header: task for task in Task.objects.all()}
        edges = set(
            (by_header_reverse[p], by_header_reverse[s])
            for p, s in TaskDependency.objects.values_list(
                "predecessor__header", "successor__header",
            )
        ) if (by_header_reverse := {h: h for h in by_header}) else set()
        self.assertIn(("Design schema", "Implement API"), edges)
        self.assertIn(("Payment integration", "Load test"), edges)
        self.assertIn(("Research CMS options", "Write CMS comparison"), edges)
        self.assertGreaterEqual(TaskDependency.objects.count(), 6)

    def test_deadline_bucket_types_and_appointment_are_present(self):
        self.assertTrue(
            Task.objects.filter(header="Load test",
                                latest_finish_date__isnull=False).exists()
        )
        type_names = set(TimeBucketType.objects.values_list("name", flat=True))
        self.assertEqual(len(type_names), 3)
        appointment = Task.objects.get(is_appointment=True)
        self.assertEqual(appointment.header, "Client call")
        self.assertEqual(appointment.start_date.weekday(), 3)  # Thursday

    def test_demo_plan_offers_a_real_choice(self):
        client = APIClient()
        alternatives = client.post("/api/plan/alternatives/").data["alternatives"]
        self.assertGreaterEqual(len(alternatives), 2)
        labels = " | ".join(a["label"] for a in alternatives)
        self.assertTrue("Design schema" in labels or "Research CMS" in labels,
                        f"expected focus labels, got: {labels}")
        Plan.objects.all().delete()


class AcceptedPlanIncludesFreeCapacityTest(TestCase):
    """A9 regression: the accepted-plan payload must also contain the *empty*
    upcoming buckets, otherwise the first free day can never be found."""

    def test_empty_future_buckets_appear_after_acceptance(self):
        client = APIClient()
        TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=4),
        )
        Task.objects.create(header="Small", duration=timedelta(hours=2))
        alternatives = client.post("/api/plan/alternatives/").data["alternatives"]
        client.post(f"/api/plans/{alternatives[0]['id']}/accept/")

        response = client.get("/api/plan/")

        buckets = response.data["buckets"]
        empty = [bucket for bucket in buckets if not bucket["items"]]
        planned = [bucket for bucket in buckets if bucket["items"]]
        self.assertTrue(planned, "the task must be planned somewhere")
        self.assertGreaterEqual(len(empty), 50)  # ~60-day daily horizon
        self.assertTrue(all(bucket["persisted"] is False for bucket in empty
                            if bucket["id"] not in {b["id"] for b in planned}))
