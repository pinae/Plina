"""UI-2: planning on the task tree (docs/task-entry-ui.md §4, §10).

* Plannable units are the open leaves plus one Rest placeholder per parent
  with a positive Rest (planned under the parent's id, ``is_rest``).
* Leaves inherit the effective (earliest) deadline of their ancestors.
* A dependency on/of a parent applies to all units in its subtree; the Rest
  waits for the children when they are ordered ("do these in this order").
* Dependencies and re-parenting that would create a cycle through the tree
  are rejected.
* Completing the last open child completes its parents (Rest dropped);
  ``reopen`` undoes it.
"""
from datetime import timedelta

from tasks.tests.support import TestCase
from django.utils import timezone
from tasks.tests.support import APIClient

from tasks.models import Plan, Task, TaskDependency, TimeBucket, TimeBucketType
from tasks.services.planner_service import allocate_tasks, build_planning_tasks, rank_tasks
from tasks.services.tree import TreeIndex, expand_edges


def hours(n):
    return timedelta(hours=n)


class TreeMixin:
    """T250 (20h) › Hardware Design (12h) › CAD (3h), test prints (2h);
    T250 › Firmware (4h). Rest of HD = 7h, Rest of T250 = 20 − 16 = 4h."""

    def make_tree(self):
        self.t250 = Task.objects.create(header="T250", duration=hours(20))
        self.hardware = Task.objects.create(header="Hardware Design", duration=hours(12),
                                            parent=self.t250, order=0)
        self.firmware = Task.objects.create(header="Firmware", duration=hours(4),
                                            parent=self.t250, order=1)
        self.cad = Task.objects.create(header="CAD", duration=hours(3),
                                       parent=self.hardware, order=0)
        self.prints = Task.objects.create(header="test prints", duration=hours(2),
                                          parent=self.hardware, order=1)

    def units(self):
        return {(s.header, s.is_rest): s for s in build_planning_tasks(Task.objects.all())}


class PlanningUnitsTest(TreeMixin, TestCase):
    def setUp(self):
        self.make_tree()

    def test_leaves_and_positive_rests_are_planned(self):
        units = self.units()
        self.assertEqual(set(units), {
            ("CAD", False), ("test prints", False), ("Firmware", False),
            ("Rest of Hardware Design", True), ("Rest of T250", True),
        })
        rest = units[("Rest of Hardware Design", True)]
        self.assertEqual(rest.id, self.hardware.id)
        self.assertEqual(rest.remaining_duration, hours(7))
        self.assertEqual(rest.project_id, self.t250.id)
        self.assertEqual(units[("Rest of T250", True)].project_id, self.t250.id)
        self.assertEqual(units[("Rest of T250", True)].remaining_duration, hours(4))

    def test_time_spent_on_the_parent_reduces_its_rest(self):
        self.hardware.time_spent = hours(2)
        self.hardware.save()
        self.assertEqual(self.units()[("Rest of Hardware Design", True)].remaining_duration, hours(5))

    def test_no_rest_unit_without_rest(self):
        Task.objects.create(header="assembly", duration=hours(7), parent=self.hardware, order=2)
        self.assertNotIn(("Rest of Hardware Design", True), self.units())

    def test_leaves_inherit_the_earliest_deadline(self):
        deadline = timezone.now() + timedelta(days=5)
        self.t250.latest_finish_date = deadline
        self.t250.save()
        units = self.units()
        self.assertEqual(units[("CAD", False)].latest_finish_date, deadline)
        self.assertEqual(units[("Rest of Hardware Design", True)].latest_finish_date, deadline)

    def test_unestimated_leaves_use_the_default_duration(self):
        Task.objects.create(header="orders", parent=self.hardware, order=2)
        self.assertEqual(self.units()[("orders", False)].remaining_duration, hours(1))


class EdgeExpansionTest(TreeMixin, TestCase):
    def setUp(self):
        self.make_tree()
        self.before = Task.objects.create(header="order filament", duration=hours(1))
        self.after = Task.objects.create(header="assembly party", duration=hours(1))

    def expanded(self, edges):
        tree = TreeIndex.load()
        unit_ids = {s.id for s in build_planning_tasks(Task.objects.all())}
        return set(expand_edges(edges, tree, unit_ids))

    def test_dependency_on_a_parent_applies_to_its_whole_subtree(self):
        edges = self.expanded([(self.before.id, self.hardware.id)])
        self.assertEqual(edges, {
            (self.before.id, self.cad.id), (self.before.id, self.prints.id),
            (self.before.id, self.hardware.id),  # the Rest of Hardware Design
        })

    def test_depending_on_a_parent_waits_for_its_whole_subtree(self):
        edges = self.expanded([(self.hardware.id, self.after.id)])
        self.assertEqual(edges, {
            (self.cad.id, self.after.id), (self.prints.id, self.after.id),
            (self.hardware.id, self.after.id),
        })

    def test_rest_follows_ordered_children(self):
        edges = self.expanded([(self.cad.id, self.prints.id)])
        self.assertEqual(edges, {(self.cad.id, self.prints.id), (self.prints.id, self.hardware.id)})

    def test_rest_is_free_when_children_are_unordered(self):
        self.assertEqual(self.expanded([]), set())


class TreeAllocationTest(TreeMixin, TestCase):
    """Acceptance: a dependency on a parent delays successors until all its
    leaves and its Rest are allocated."""

    def test_successor_of_a_parent_runs_after_the_whole_subtree(self):
        self.make_tree()
        after = Task.objects.create(header="assembly party", duration=hours(1), priority=10)
        now = timezone.now().replace(minute=0, second=0, microsecond=0)
        general = TimeBucketType.objects.create(name="General", duration=hours(4))
        buckets = [TimeBucket.objects.create(start_date=now + timedelta(days=d, hours=1),
                                             duration=hours(4), type=general) for d in range(10)]
        TaskDependency.objects.create(predecessor=self.hardware, successor=after)

        from tasks.services.planner_service import planning_edges
        snapshots = build_planning_tasks(Task.objects.all())
        plan = allocate_tasks(buckets, rank_tasks(snapshots, now), planning_edges(snapshots))

        items = [item for bucket in buckets for item in plan[bucket.id]]
        subtree_end = max(i.start_time + i.duration for i in items
                          if i.task in (self.cad, self.prints, self.hardware))
        after_start = min(i.start_time for i in items if i.task == after)
        self.assertGreaterEqual(after_start, subtree_end)
        rest_items = [i for i in items if i.task == self.hardware]
        self.assertTrue(rest_items and all(i.is_rest for i in rest_items))
        self.assertEqual(sum((i.duration for i in rest_items), timedelta(0)), hours(7))


class RestInPlanApiTest(TreeMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.make_tree()
        TimeBucketType.objects.create(name="Daily", start_times="every day at 09:00",
                                      duration=hours(4))

    def rest_items(self, payload_buckets):
        return [item for bucket in payload_buckets for item in bucket["items"] if item["is_rest"]]

    def test_alternatives_and_accepted_plan_mark_rest_items(self):
        response = self.client.post("/api/plan/alternatives/")
        alternative = response.data["alternatives"][0]
        rests = self.rest_items(alternative["buckets"])
        self.assertIn("Rest of Hardware Design", {item["header"] for item in rests})
        self.assertEqual({item["task_id"] for item in rests}, {self.hardware.id, self.t250.id})

        self.client.post(f"/api/plans/{alternative['id']}/accept/")
        plan = self.client.get("/api/plan/").data
        rests = self.rest_items(plan["buckets"])
        self.assertIn("Rest of Hardware Design", {item["header"] for item in rests})
        self.assertTrue(Plan.objects.get(is_accepted=True).entries.filter(is_rest=True).exists())

        # A recalculation keeps planning the Rest.
        self.client.post("/api/tasks/", {"header": "x", "duration": "01:00:00"}, format="json")
        plan = self.client.get("/api/plan/").data
        self.assertTrue(self.rest_items(plan["buckets"]))


class TreeDependencyValidationTest(TreeMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.make_tree()

    def post_edge(self, predecessor, successor):
        return self.client.post("/api/dependencies/", {
            "predecessor": str(predecessor.id), "successor": str(successor.id),
        }, format="json")

    def test_edge_between_a_task_and_its_ancestor_is_rejected(self):
        for predecessor, successor in [(self.cad, self.t250), (self.hardware, self.cad)]:
            response = self.post_edge(predecessor, successor)
            self.assertEqual(response.status_code, 400)
            self.assertIn("part of", str(response.data["detail"]))

    def test_cycle_through_the_tree_is_rejected(self):
        outside = Task.objects.create(header="order filament", duration=hours(1))
        self.assertEqual(self.post_edge(outside, self.hardware).status_code, 201)
        # CAD is part of Hardware Design, which waits for "order filament".
        response = self.post_edge(self.cad, outside)
        self.assertEqual(response.status_code, 400)
        self.assertIn("cycle", str(response.data["detail"]))
        self.assertIn(str(outside.id), response.data["cycle"])

    def test_moving_a_task_into_a_cycle_is_rejected(self):
        outside = Task.objects.create(header="order filament", duration=hours(1))
        TaskDependency.objects.create(predecessor=outside, successor=self.hardware)
        loose = Task.objects.create(header="loose", duration=hours(1))
        TaskDependency.objects.create(predecessor=loose, successor=outside)
        response = self.client.patch(f"/api/tasks/{loose.id}/",
                                     {"parent_id": str(self.hardware.id)}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("cycle", str(response.data["parent_id"][0]))

    def test_tracking_is_blocked_by_an_ancestors_predecessor(self):
        outside = Task.objects.create(header="order filament", duration=hours(1))
        TaskDependency.objects.create(predecessor=outside, successor=self.hardware)
        response = self.client.post(f"/api/tasks/{self.cad.id}/track/start/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual([p["header"] for p in response.data["predecessors"]], ["order filament"])


class AutoCompletionTest(TreeMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.make_tree()
        self.firmware.completed_at = timezone.now()
        self.firmware.save()

    def complete(self, task):
        return self.client.post(f"/api/tasks/{task.id}/complete/")

    def test_completing_a_non_last_child_completes_nothing_else(self):
        response = self.complete(self.cad)
        self.assertEqual(response.data["auto_completed"], [])
        self.hardware.refresh_from_db()
        self.assertFalse(self.hardware.is_done)

    def test_completing_the_last_child_completes_parent_and_grandparent(self):
        self.complete(self.cad)
        response = self.complete(self.prints)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([t["header"] for t in response.data["auto_completed"]],
                         ["Hardware Design", "T250"])
        self.hardware.refresh_from_db()
        self.t250.refresh_from_db()
        self.assertTrue(self.hardware.is_done and self.t250.is_done)
        self.assertEqual(self.hardware.completion_dropped_rest, hours(7))

    def test_reopen_restores_the_parent_and_its_ancestors(self):
        self.complete(self.cad)
        self.complete(self.prints)
        response = self.client.post(f"/api/tasks/{self.hardware.id}/reopen/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(response.data["reopened"]), {self.hardware.id, self.t250.id})
        self.hardware.refresh_from_db()
        self.prints.refresh_from_db()
        self.assertFalse(self.hardware.is_done)
        self.assertIsNone(self.hardware.completion_dropped_rest)
        self.assertTrue(self.prints.is_done)  # the child stays done
        # The reopened parent's Rest is planned again.
        self.assertIn(("Rest of Hardware Design", True), self.units())

    def test_reopening_an_open_task_is_refused(self):
        self.assertEqual(self.client.post(f"/api/tasks/{self.cad.id}/reopen/").status_code, 400)

    def test_a_parent_with_open_children_cannot_be_completed(self):
        response = self.complete(self.hardware)
        self.assertEqual(response.status_code, 400)
        self.assertIn("2 open subtasks", response.data["detail"])

    def test_completing_via_patch_also_completes_the_parents(self):
        self.complete(self.cad)
        self.client.patch(f"/api/tasks/{self.prints.id}/",
                          {"completed_at": timezone.now().isoformat()}, format="json")
        self.hardware.refresh_from_db()
        self.assertTrue(self.hardware.is_done)
