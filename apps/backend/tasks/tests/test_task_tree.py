"""UI-1: the task tree replaces the Project model (docs/task-entry-ui.md §10).

Every top-level task is a project; tasks can be split indefinitely via
``parent``. These tests pin the API contract, the tree validation, deletion
modes, estimate history, completion snapshots, the ``/api/projects/``
compatibility view and the planner's handling of parents.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Task, TaskEstimateChange


def hours(n):
    return timedelta(hours=n)


class TreeFixtureMixin:
    """T250 (20h) › Hardware Design (12h) › CAD (3h), test prints (2h)."""

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


class TreeApiTest(TreeFixtureMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.make_tree()

    def get(self, task):
        return self.client.get(f"/api/tasks/{task.id}/").data

    def test_tree_fields_are_serialized(self):
        data = self.get(self.hardware)
        self.assertEqual(data["parent_id"], self.t250.id)
        self.assertEqual(data["children_ids"], [self.cad.id, self.prints.id])
        self.assertEqual(data["ancestor_ids"], [self.t250.id])
        self.assertEqual(self.get(self.cad)["ancestor_ids"], [self.t250.id, self.hardware.id])
        self.assertIsNone(self.get(self.t250)["parent_id"])

    def test_create_child_appends_to_the_siblings(self):
        response = self.client.post("/api/tasks/", {
            "header": "assembly", "duration": "02:00:00", "parent_id": str(self.hardware.id),
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["parent_id"], self.hardware.id)
        self.assertEqual(str(self.get(self.hardware)["children_ids"][-1]), response.data["id"])

    def test_budget_fields(self):
        data = self.get(self.hardware)
        self.assertTrue(data["is_estimated"])
        self.assertEqual(data["parts_total"], "05:00:00")
        self.assertEqual(data["rest"], "07:00:00")
        self.assertFalse(data["over_budget"])
        leaf = self.get(self.cad)
        self.assertIsNone(leaf["parts_total"])
        self.assertIsNone(leaf["rest"])
        self.assertFalse(leaf["over_budget"])

    def test_time_spent_on_the_parent_reduces_its_rest(self):
        self.hardware.time_spent = hours(1)
        self.hardware.save()
        self.assertEqual(self.get(self.hardware)["rest"], "06:00:00")

    def test_over_budget_when_parts_exceed_the_estimate(self):
        Task.objects.create(header="assembly", duration=hours(8), parent=self.hardware, order=2)
        data = self.get(self.hardware)
        self.assertTrue(data["over_budget"])
        self.assertEqual(data["rest"], "00:00:00")

    def test_unestimated_tasks_count_with_the_default_duration(self):
        Task.objects.create(header="orders", parent=self.hardware, order=2)
        data = self.get(self.hardware)
        self.assertEqual(data["parts_total"], "06:00:00")  # 3h + 2h + 1h default
        orders = Task.objects.get(header="orders")
        self.assertFalse(self.get(orders)["is_estimated"])

    def test_effective_deadline_is_the_earliest_of_the_ancestors(self):
        deadline = timezone.now() + timedelta(days=10)
        self.t250.latest_finish_date = deadline
        self.t250.save()
        self.assertEqual(self.get(self.cad)["effective_deadline"],
                         deadline.isoformat().replace("+00:00", "Z"))

    def test_move_into_another_parent(self):
        response = self.client.patch(f"/api/tasks/{self.cad.id}/",
                                     {"parent_id": str(self.firmware.id)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.get(self.firmware)["children_ids"], [self.cad.id])
        self.assertEqual(self.get(self.hardware)["children_ids"], [self.prints.id])

    def test_move_to_top_level(self):
        response = self.client.patch(f"/api/tasks/{self.cad.id}/",
                                     {"parent_id": None}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(self.get(self.cad)["parent_id"])


class TreeValidationTest(TreeFixtureMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.make_tree()

    def test_a_task_cannot_be_its_own_parent(self):
        response = self.client.patch(f"/api/tasks/{self.cad.id}/",
                                     {"parent_id": str(self.cad.id)}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("parent_id", response.data)

    def test_moving_into_the_own_subtree_is_rejected_with_the_path(self):
        response = self.client.patch(f"/api/tasks/{self.t250.id}/",
                                     {"parent_id": str(self.cad.id)}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("CAD", str(response.data["parent_id"][0]))
        self.assertEqual(response.data["path"],
                         [str(self.t250.id), str(self.hardware.id), str(self.cad.id)])
        self.t250.refresh_from_db()
        self.assertIsNone(self.t250.parent_id)

    def test_deadline_later_than_an_ancestor_is_rejected(self):
        self.t250.latest_finish_date = timezone.now() + timedelta(days=10)
        self.t250.save()
        response = self.client.patch(f"/api/tasks/{self.cad.id}/", {
            "latest_finish_date": (timezone.now() + timedelta(days=20)).isoformat(),
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("T250", str(response.data["latest_finish_date"][0]))

    def test_deadline_earlier_than_the_ancestors_is_fine(self):
        self.t250.latest_finish_date = timezone.now() + timedelta(days=10)
        self.t250.save()
        response = self.client.patch(f"/api/tasks/{self.cad.id}/", {
            "latest_finish_date": (timezone.now() + timedelta(days=5)).isoformat(),
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def test_new_child_with_a_later_deadline_is_rejected(self):
        self.hardware.latest_finish_date = timezone.now() + timedelta(days=3)
        self.hardware.save()
        response = self.client.post("/api/tasks/", {
            "header": "late", "parent_id": str(self.hardware.id),
            "latest_finish_date": (timezone.now() + timedelta(days=4)).isoformat(),
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Hardware Design", str(response.data["latest_finish_date"][0]))

    def test_moving_alone_is_not_rejected_for_deadlines(self):
        # The effective deadline takes over; re-parenting stays frictionless.
        self.firmware.latest_finish_date = timezone.now() + timedelta(days=1)
        self.firmware.save()
        self.cad.latest_finish_date = timezone.now() + timedelta(days=5)
        self.cad.save()
        response = self.client.patch(f"/api/tasks/{self.cad.id}/",
                                     {"parent_id": str(self.firmware.id)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)


class TreeDeletionTest(TreeFixtureMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.make_tree()

    def test_deleting_a_leaf_needs_no_choice(self):
        response = self.client.delete(f"/api/tasks/{self.cad.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Task.objects.filter(id=self.cad.id).exists())

    def test_deleting_a_parent_without_a_choice_is_refused(self):
        response = self.client.delete(f"/api/tasks/{self.hardware.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("children", response.data["detail"])
        self.assertTrue(Task.objects.filter(id=self.hardware.id).exists())

    def test_lift_moves_the_children_up_into_the_parents_position(self):
        response = self.client.delete(f"/api/tasks/{self.hardware.id}/?children=lift")
        self.assertEqual(response.status_code, 204)
        order = list(Task.objects.filter(parent=self.t250).order_by("order")
                     .values_list("header", flat=True))
        self.assertEqual(order, ["CAD", "test prints", "Firmware"])

    def test_delete_cascades_to_all_descendants(self):
        response = self.client.delete(f"/api/tasks/{self.t250.id}/?children=delete")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(Task.objects.count(), 0)

    def test_unknown_mode_is_rejected(self):
        response = self.client.delete(f"/api/tasks/{self.hardware.id}/?children=maybe")
        self.assertEqual(response.status_code, 400)


class EstimateHistoryTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_and_edit_are_recorded(self):
        created = self.client.post("/api/tasks/", {"header": "Report", "duration": "02:00:00"},
                                   format="json").data
        self.client.patch(f"/api/tasks/{created['id']}/", {"duration": "03:30:00"}, format="json")
        rows = list(TaskEstimateChange.objects.filter(task_id=created["id"])
                    .order_by("changed_at").values_list("reason", "old_duration", "new_duration"))
        self.assertEqual(rows, [
            ("created", None, hours(2)),
            ("edited", hours(2), timedelta(hours=3, minutes=30)),
        ])

    def test_unestimated_creation_is_recorded_too(self):
        created = self.client.post("/api/tasks/", {"header": "Call landlord"}, format="json").data
        change = TaskEstimateChange.objects.get(task_id=created["id"])
        self.assertEqual((change.reason, change.new_duration), ("created", None))

    def test_edits_without_estimate_change_are_not_recorded(self):
        created = self.client.post("/api/tasks/", {"header": "Report", "duration": "02:00:00"},
                                   format="json").data
        self.client.patch(f"/api/tasks/{created['id']}/", {"header": "Final report",
                                                            "duration": "02:00:00"}, format="json")
        self.assertEqual(TaskEstimateChange.objects.filter(task_id=created["id"]).count(), 1)


class CompletionSnapshotTest(TreeFixtureMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.make_tree()

    def test_completing_stores_estimates_and_tracked_time(self):
        TaskEstimateChange.objects.create(task=self.cad, old_duration=None,
                                          new_duration=hours(2), reason="created")
        TaskEstimateChange.objects.create(task=self.cad, old_duration=hours(2),
                                          new_duration=hours(3), reason="edited")
        self.cad.time_spent = timedelta(hours=3, minutes=20)  # tracked above the estimate
        self.cad.save()
        response = self.client.post(f"/api/tasks/{self.cad.id}/complete/")
        self.assertEqual(response.status_code, 200, response.data)
        self.cad.refresh_from_db()
        self.assertEqual(self.cad.completion_estimate, hours(3))
        self.assertEqual(self.cad.completion_first_estimate, hours(2))
        self.assertEqual(self.cad.completion_time_spent, timedelta(hours=3, minutes=20))
        self.assertEqual(self.cad.completion_subtree_time_spent, timedelta(0))

    def test_parent_snapshot_rolls_up_descendants_and_keeps_the_dropped_rest(self):
        self.cad.time_spent = hours(4)
        self.cad.save()
        self.hardware.time_spent = hours(1)
        self.hardware.save()
        self.client.post(f"/api/tasks/{self.hardware.id}/complete/")
        self.hardware.refresh_from_db()
        self.assertEqual(self.hardware.completion_time_spent, hours(1))
        self.assertEqual(self.hardware.completion_subtree_time_spent, hours(4))
        self.assertEqual(self.hardware.completion_dropped_rest, hours(6))  # 12 - 5 - 1

    def test_completing_via_patch_also_snapshots_and_reopening_clears(self):
        self.client.patch(f"/api/tasks/{self.prints.id}/",
                          {"completed_at": timezone.now().isoformat()}, format="json")
        self.prints.refresh_from_db()
        self.assertEqual(self.prints.completion_estimate, hours(2))
        self.client.patch(f"/api/tasks/{self.prints.id}/", {"completed_at": None}, format="json")
        self.prints.refresh_from_db()
        self.assertIsNone(self.prints.completion_estimate)


class ProjectsCompatibilityTest(TreeFixtureMixin, TestCase):
    """``/api/projects/`` keeps its old shape over top-level tasks until UI-8."""

    def setUp(self):
        self.client = APIClient()
        self.make_tree()
        self.milk = Task.objects.create(header="Buy milk", order=1)

    def test_lists_top_level_tasks_with_all_descendants(self):
        response = self.client.get("/api/projects/")
        self.assertEqual(response.status_code, 200)
        by_name = {project["name"]: project for project in response.data}
        self.assertEqual(set(by_name), {"T250", "Buy milk"})
        self.assertEqual(by_name["T250"]["id"], str(self.t250.id))
        self.assertEqual(by_name["T250"]["task_ids"], [
            self.hardware.id, self.cad.id, self.prints.id, self.firmware.id,
        ])
        self.assertEqual(by_name["Buy milk"]["task_ids"], [])

    def test_creating_a_project_creates_a_top_level_task(self):
        response = self.client.post("/api/projects/", {
            "name": "Company Blog", "description": "", "priority": 6,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(id=response.data["id"])
        self.assertEqual((task.header, task.parent_id, task.priority), ("Company Blog", None, 6))

    def test_renaming_a_project_renames_the_task(self):
        response = self.client.patch(f"/api/projects/{self.t250.id}/", {"name": "T300"},
                                     format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.t250.refresh_from_db()
        self.assertEqual(self.t250.header, "T300")

    def test_deleting_a_project_keeps_its_tasks(self):
        response = self.client.delete(f"/api/projects/{self.t250.id}/")
        self.assertEqual(response.status_code, 204)
        self.hardware.refresh_from_db()
        self.assertIsNone(self.hardware.parent_id)
        self.assertTrue(Task.objects.filter(id=self.cad.id, parent=self.hardware).exists())

    def test_task_project_id_is_the_top_level_ancestor(self):
        self.assertEqual(self.client.get(f"/api/tasks/{self.cad.id}/").data["project_id"],
                         self.t250.id)
        self.assertIsNone(self.client.get(f"/api/tasks/{self.t250.id}/").data["project_id"])

    def test_writing_project_id_moves_the_task(self):
        response = self.client.patch(f"/api/tasks/{self.firmware.id}/",
                                     {"project_id": str(self.milk.id)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.firmware.refresh_from_db()
        self.assertEqual(self.firmware.parent_id, self.milk.id)

    def test_resending_the_same_project_keeps_a_nested_task_in_place(self):
        # The old form sends the project it was shown back on every save.
        response = self.client.patch(f"/api/tasks/{self.cad.id}/", {
            "header": "CAD v2", "project_id": str(self.t250.id),
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.cad.refresh_from_db()
        self.assertEqual(self.cad.parent_id, self.hardware.id)


class PlannerTreeTest(TreeFixtureMixin, TestCase):
    def setUp(self):
        self.make_tree()

    def test_parents_are_not_planned_as_blocks(self):
        from tasks.services.planner_service import build_planning_tasks
        headers = {s.header for s in build_planning_tasks(Task.objects.all())}
        self.assertEqual(headers, {"CAD", "test prints", "Firmware"})

    def test_project_id_is_the_top_level_ancestor(self):
        from tasks.services.planner_service import build_planning_tasks
        snapshots = {s.header: s for s in build_planning_tasks(Task.objects.all())}
        self.assertEqual(snapshots["CAD"].project_id, self.t250.id)
        self.assertEqual(snapshots["Firmware"].project_id, self.t250.id)
        milk = Task.objects.create(header="Buy milk", duration=hours(1))
        solo = [s for s in build_planning_tasks([milk])][0]
        self.assertIsNone(solo.project_id)
