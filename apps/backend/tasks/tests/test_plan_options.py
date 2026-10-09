"""What "Plan my week" offers (docs/plan-chooser.md):

* a running task comes first in every plan, and in "Re-plan";
* "Flow" stays in the running task's project before switching;
* "Deadline-safe" follows priority as far as deadlines allow;
* without a running task the options start with different projects: the
  highest-priority one and the ones worked on most recently.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock

from tasks.models import Tag, Task, TimeBucket, TimeBucketType, TrackingSession
from tasks.services.alternatives import generate_alternatives, planning_context
from tasks.services.bucket_service import gather_time_buckets
from tasks.services.planner_service import UNBUCKETED, build_planning_tasks
from tasks.tests.support import APIClient, TestCase

UTC = dt_timezone.utc
#: Thursday 10:00, inside the day's bucket (09:00–13:00).
NOW = datetime(2026, 10, 8, 10, 0, tzinfo=UTC)


def hours(value):
    return timedelta(hours=value)


class PlanOptionsCase(TestCase):
    def setUp(self):
        self.general = TimeBucketType.objects.create(name="General", duration=hours(4))
        self.buckets = [
            TimeBucket.objects.create(start_date=NOW.replace(hour=9) + timedelta(days=day),
                                      duration=hours(4), type=self.general)
            for day in range(10)
        ]

    def project(self, name, headers, priority=5, **task_kwargs):
        project = Task.objects.create(header=name, priority=priority)
        return [Task.objects.create(header=header, parent=project, order=order, priority=priority,
                                    duration=task_kwargs.pop("duration", hours(2)), **task_kwargs)
                for order, header in enumerate(headers)]

    def track(self, task, start, end=None):
        return TrackingSession.objects.create(task=task, start=start, end=end)

    def alternatives(self, edges=()):
        snapshots = build_planning_tasks(Task.objects.filter(completed_at=None).prefetch_related("tags"),
                                         now=NOW)
        # As the API gathers them: the bucket under way starts now.
        buckets = gather_time_buckets(NOW, NOW + timedelta(days=10))
        return generate_alternatives(snapshots, buckets, list(edges), NOW, context=planning_context(NOW))

    @staticmethod
    def work(alternative):
        """Planned work, by start: (header, start, end); appointments left out."""
        items = [item for key, items in alternative.plan.items() if key is not UNBUCKETED for item in items]
        return [(item.task.header, item.start_time, item.start_time + item.duration)
                for item in sorted(items, key=lambda item: item.start_time)]

    def headers(self, alternative):
        seen = []
        for header, _, _ in self.work(alternative):
            if header not in seen:
                seen.append(header)
        return seen


class RunningTaskFirstTest(PlanOptionsCase):
    def test_every_plan_goes_on_with_the_running_task_from_now(self):
        self.project("Webshop", ["A1", "A2"], priority=9)
        b1, _ = self.project("Blog", ["B1", "B2"], priority=2)  # stay, or switch to the Webshop
        self.track(b1, NOW - timedelta(minutes=30))

        alternatives = self.alternatives()

        self.assertGreaterEqual(len(alternatives), 2)
        for alternative in alternatives:
            # What is left of it (2 h − the 30 min running), from now.
            self.assertEqual(self.work(alternative)[0], ("B1", NOW, NOW + timedelta(minutes=90)), alternative.label)

    def test_also_in_a_bucket_for_other_work_and_before_tasks_pinned_earlier(self):
        maker = Tag.objects.create(name="maker")
        self.general.tags.add(maker)  # the time now is for #maker work
        writing = Tag.objects.create(name="writing")
        b1, = self.project("Blog", ["B1"], priority=2)
        b1.tags.add(writing)
        old, = self.project("Webshop", ["Old"], priority=9, is_fixed=True, start_date=NOW - timedelta(days=1))
        old.tags.add(maker)
        self.track(b1, NOW - timedelta(minutes=30))

        for alternative in self.alternatives():
            self.assertEqual(self.work(alternative)[0][0], "B1", alternative.label)

    def test_replan_goes_on_with_the_running_task_too(self):
        self.project("Webshop", ["A1", "A2"], priority=9)
        b1, = self.project("Blog", ["B1"], priority=2)
        api = APIClient()
        with mock.patch("django.utils.timezone.now", return_value=NOW):
            accepted = api.post("/api/plan/alternatives/").json()["alternatives"][0]
            api.post(f"/api/plans/{accepted['id']}/accept/")
            self.track(b1, NOW - timedelta(minutes=30))
            plan = api.post("/api/plan/recalculate/").json()
        items = sorted((item for bucket in plan["buckets"] for item in bucket["items"]),
                       key=lambda item: item["start_time"])
        self.assertEqual(items[0]["header"], "B1")


class FlowStaysInTheProjectTest(PlanOptionsCase):
    def test_after_the_running_task_flow_continues_its_project(self):
        a1, _, _ = self.project("Webshop", ["A1", "A2", "A3"], priority=3)
        self.project("Blog", ["B1", "B2"], priority=9,
                     latest_finish_date=NOW + timedelta(days=3))
        self.track(a1, NOW - timedelta(minutes=30))

        flow = next(alternative for alternative in self.alternatives() if alternative.preset == "flow")

        self.assertEqual(self.headers(flow)[:3], ["A1", "A2", "A3"])
        self.assertIn("Webshop", flow.label)

    def test_switching_after_the_running_task_says_so(self):
        a1, _, _ = self.project("Webshop", ["A1", "A2", "A3"], priority=3)
        self.project("Blog", ["B1", "B2"], priority=9)
        self.track(a1, NOW - timedelta(minutes=30))

        labels = [alternative.label for alternative in self.alternatives()]

        self.assertIn("Then Blog (highest priority)", labels)


class DeadlineSafeFollowsPriorityTest(PlanOptionsCase):
    """One project, so the plan shows the strategy, not a choice of project."""

    def deadline_safe(self):
        return next(alternative for alternative in self.alternatives() if alternative.preset == "deadline_safe")

    def work_items(self, low_deadline):
        project = Task.objects.create(header="Work")
        Task.objects.create(header="Low", parent=project, priority=2, duration=hours(2),
                            latest_finish_date=low_deadline)
        Task.objects.create(header="High", parent=project, priority=9, duration=hours(2))

    def test_a_far_deadline_does_not_beat_a_higher_priority(self):
        self.work_items(NOW + timedelta(days=8))

        plan = self.deadline_safe()

        self.assertEqual(self.headers(plan), ["High", "Low"])
        self.assertTrue(plan.feasible)

    def test_but_a_deadline_that_would_be_missed_still_comes_first(self):
        # Until the deadline (12:30) there is room for one task only.
        self.work_items(NOW + hours(2.5))

        plan = self.deadline_safe()

        self.assertEqual(self.headers(plan), ["Low", "High"])
        self.assertTrue(plan.feasible)


class OptionsByProjectTest(PlanOptionsCase):
    def setUp(self):
        super().setUp()
        self.project("Webshop", ["W1", "W2"], priority=9)
        self.blog = self.project("Blog", ["B1", "B2"], priority=5)
        self.garden = self.project("Garden", ["G1"], priority=3)
        self.project("Admin", ["D1"], priority=4)
        # Worked on: the blog three days ago, the garden yesterday.
        self.track(self.blog[0], NOW - timedelta(days=3, hours=2), NOW - timedelta(days=3, hours=1))
        self.track(self.garden[0], NOW - timedelta(days=1, hours=2), NOW - timedelta(days=1, hours=1))

    def test_offers_the_highest_priority_and_the_recently_worked_on_projects(self):
        alternatives = self.alternatives()
        first = {self.headers(alternative)[0] for alternative in alternatives}
        self.assertTrue({"W1", "G1", "B1"} <= first, first)
        labels = [alternative.label for alternative in alternatives]
        self.assertIn("Highest priority: Webshop", labels)
        self.assertIn("Continue Garden", labels)
        self.assertIn("Continue Blog", labels)
        self.assertEqual(len(labels), len(set(labels)))

    def test_options_start_with_different_projects(self):
        firsts = [self.headers(alternative)[0] for alternative in self.alternatives()]
        self.assertEqual(len(firsts), len(set(firsts)), firsts)

    def test_the_api_says_what_each_option_is_about(self):
        with mock.patch("django.utils.timezone.now", return_value=NOW):
            alternatives = APIClient().post("/api/plan/alternatives/").json()["alternatives"]
        about = {(alternative["kind"], (alternative["project"] or {}).get("name")) for alternative in alternatives}
        self.assertIn(("top_project", "Webshop"), about)
        self.assertIn(("recent_project", "Garden"), about)


class TrackingDoesNotPinTest(TestCase):
    def test_starting_to_track_leaves_the_task_fluid(self):
        task = Task.objects.create(header="CAD", duration=hours(1))
        response = APIClient().post(f"/api/tasks/{task.id}/track/start/")
        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertFalse(task.is_fixed)
        self.assertIsNone(task.start_date)
