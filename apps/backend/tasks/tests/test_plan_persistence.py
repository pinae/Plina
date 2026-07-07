from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import (Plan, PlanEntry, Project, Task, TaskDependency,
                          TimeBucket, TimeBucketType)
from tasks.services.plan_store import recalculate_accepted_plan


class PlanFlowFixture(TestCase):
    """Two disjoint project chains + one appointment, buckets only via a
    recurring type — so every bucket in a stored plan starts out generated
    (unsaved) and must be materialized on acceptance (A8)."""

    def setUp(self):
        self.client = APIClient()
        self.now = timezone.now()
        TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=4),
        )
        self.webshop = Project.objects.create(name="Webshop")
        self.blog = Project.objects.create(name="Blog")
        self.a1 = self._task("A1", self.webshop)
        self.a2 = self._task("A2", self.webshop)
        self.b1 = self._task("B1", self.blog)
        TaskDependency.objects.create(predecessor=self.a1, successor=self.a2)
        self.meeting = Task.objects.create(
            header="Team Sync", duration=timedelta(hours=1),
            start_date=self.now + timedelta(days=1, hours=2),
            is_appointment=True,
        )

    def _task(self, header, project, hours=2):
        task = Task.objects.create(header=header, duration=timedelta(hours=hours))
        project.add(task)
        return task

    def post_alternatives(self):
        response = self.client.post("/api/plan/alternatives/")
        self.assertEqual(response.status_code, 200)
        return response.data["alternatives"]

    def accept(self, plan_id):
        response = self.client.post(f"/api/plans/{plan_id}/accept/")
        self.assertEqual(response.status_code, 200)
        return response


class StoreAlternativesTest(PlanFlowFixture):
    def test_post_stores_one_plan_per_alternative_with_ids(self):
        alternatives = self.post_alternatives()

        self.assertGreaterEqual(len(alternatives), 2)
        for alternative in alternatives:
            self.assertIn("id", alternative)
        self.assertEqual(Plan.objects.count(), len(alternatives))
        self.assertEqual(Plan.objects.filter(is_accepted=True).count(), 0)

    def test_entries_are_ordered_chronologically(self):
        alternatives = self.post_alternatives()

        plan = Plan.objects.get(id=alternatives[0]["id"])
        entries = list(plan.entries.all())
        self.assertTrue(entries)
        orders = [entry.order for entry in entries]
        self.assertEqual(orders, sorted(orders))
        starts = [entry.start for entry in entries]
        self.assertEqual(starts, sorted(starts))

    def test_new_post_replaces_unaccepted_candidates(self):
        first_batch = self.post_alternatives()
        second_batch = self.post_alternatives()

        self.assertEqual(Plan.objects.count(), len(second_batch))
        first_ids = {alternative["id"] for alternative in first_batch}
        self.assertFalse(Plan.objects.filter(id__in=first_ids).exists())

    def test_candidate_entries_reference_unmaterialized_buckets_by_key(self):
        alternatives = self.post_alternatives()

        self.assertEqual(TimeBucket.objects.count(), 0)  # nothing materialized yet
        plan = Plan.objects.get(id=alternatives[0]["id"])
        bucketed = plan.entries.exclude(task__is_appointment=True)
        self.assertTrue(bucketed)
        for entry in bucketed:
            self.assertIsNone(entry.bucket)
            self.assertIsNotNone(entry.bucket_key)
            self.assertIn(str(entry.bucket_key), plan.buckets_snapshot)


class AcceptFlowTest(PlanFlowFixture):
    def test_accept_marks_the_plan_and_deletes_siblings(self):
        alternatives = self.post_alternatives()
        chosen = alternatives[1]["id"]

        self.accept(chosen)

        self.assertEqual(Plan.objects.count(), 1)
        plan = Plan.objects.get()
        self.assertEqual(str(plan.id), str(chosen))
        self.assertTrue(plan.is_accepted)

    def test_accept_materializes_generated_buckets(self):
        alternatives = self.post_alternatives()

        self.accept(alternatives[0]["id"])

        plan = Plan.objects.get()
        bucketed = plan.entries.exclude(task__is_appointment=True)
        self.assertTrue(bucketed)
        for entry in bucketed:
            self.assertIsNotNone(entry.bucket)
            self.assertEqual(entry.bucket.id, entry.bucket_key)
        self.assertEqual(
            TimeBucket.objects.count(),
            len({entry.bucket_id for entry in bucketed}),
        )

    def test_accepting_a_new_plan_replaces_a_previously_accepted_one(self):
        first = self.post_alternatives()
        self.accept(first[0]["id"])
        second = self.post_alternatives()

        self.accept(second[0]["id"])

        self.assertEqual(Plan.objects.count(), 1)
        self.assertTrue(Plan.objects.get().is_accepted)

    def test_accepting_does_not_fix_any_task(self):
        """The fluidity principle: only tracking/manual placement fixes tasks."""
        alternatives = self.post_alternatives()

        self.accept(alternatives[0]["id"])

        for task in (self.a1, self.a2, self.b1):
            task.refresh_from_db()
            self.assertFalse(task.is_fixed)


class AcceptedPlanEndpointTest(PlanFlowFixture):
    def test_get_plan_returns_the_accepted_plan(self):
        alternatives = self.post_alternatives()
        chosen = alternatives[0]["id"]
        self.accept(chosen)

        response = self.client.get("/api/plan/")

        self.assertEqual(str(response.data["accepted_plan_id"]), str(chosen))
        items = [
            item for bucket in response.data["buckets"] for item in bucket["items"]
        ]
        self.assertTrue(items)
        headers = {item["header"] for item in items}
        self.assertIn("A1", headers)
        for item in items:
            self.assertIn("order", item)
        appointment_headers = [
            item["header"] for item in response.data["appointments"]
        ]
        self.assertEqual(appointment_headers, ["Team Sync"])

    def test_get_plan_without_accepted_plan_falls_back_to_live_computation(self):
        response = self.client.get("/api/plan/")

        self.assertIsNone(response.data["accepted_plan_id"])
        self.assertTrue(response.data["buckets"])  # live default plan


class RecalculationTest(PlanFlowFixture):
    def _accept_first(self):
        alternatives = self.post_alternatives()
        self.accept(alternatives[0]["id"])
        return Plan.objects.get()

    def test_recalculation_keeps_anchored_entries_byte_identical(self):
        plan = self._accept_first()
        anchored_before = list(
            plan.entries.filter(task=self.meeting)
            .values("id", "task_id", "start", "duration", "order")
        )
        self.assertTrue(anchored_before)
        Task.objects.create(header="Newcomer", duration=timedelta(hours=1))

        recalculate_accepted_plan()

        plan.refresh_from_db()
        anchored_after = list(
            plan.entries.filter(task=self.meeting)
            .values("id", "task_id", "start", "duration", "order")
        )
        self.assertEqual(anchored_before, anchored_after)

    def test_recalculation_plans_newly_added_tasks(self):
        self._accept_first()
        newcomer = Task.objects.create(header="Newcomer", duration=timedelta(hours=1))

        recalculate_accepted_plan()

        self.assertTrue(PlanEntry.objects.filter(task=newcomer).exists())

    def test_recalculation_replaces_fluid_entries(self):
        plan = self._accept_first()
        fluid_ids_before = set(
            plan.entries.exclude(task=self.meeting).values_list("id", flat=True)
        )
        Task.objects.create(
            header="Urgent", duration=timedelta(hours=2),
            latest_finish_date=self.now + timedelta(days=1),
        )

        recalculate_accepted_plan()

        fluid_ids_after = set(
            plan.entries.exclude(task=self.meeting).values_list("id", flat=True)
        )
        self.assertNotEqual(fluid_ids_before, fluid_ids_after)

    def test_recalculation_still_respects_dependencies(self):
        self._accept_first()
        Task.objects.create(header="Newcomer", duration=timedelta(hours=1))

        recalculate_accepted_plan()

        plan = Plan.objects.get()
        start_of = {}
        for entry in plan.entries.all():
            key = entry.task.header
            if key not in start_of or entry.start < start_of[key]:
                start_of[key] = entry.start
        self.assertLess(start_of["A1"], start_of["A2"])

    def test_recalculation_without_accepted_plan_is_a_noop(self):
        self.assertIsNone(recalculate_accepted_plan())
        self.assertEqual(Plan.objects.count(), 0)

    def test_plan_stores_its_generation_config(self):
        plan = self._accept_first()
        self.assertIn("preset", plan.config)


class StaleCandidateTest(PlanFlowFixture):
    """Re-POSTing alternatives wipes unaccepted candidates; accepting an id
    from an earlier response must fail loudly, not resurrect stale data."""

    def test_accepting_a_wiped_candidate_returns_404(self):
        stale_id = self.post_alternatives()[0]["id"]
        self.post_alternatives()  # replaces the candidate set

        response = self.client.post(f"/api/plans/{stale_id}/accept/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(Plan.objects.filter(is_accepted=True).count(), 0)
