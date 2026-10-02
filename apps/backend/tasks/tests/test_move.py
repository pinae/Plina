"""T-1 (docs/tasks-tab.md): POST /api/tasks/{id}/move/ — parent and position in
one atomic step, for drag and drop in the Tasks tab."""
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Task, TaskDependency
from tasks.services.planner_service import build_planning_tasks
from tasks.services.settings import activate, get_settings


class MoveTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        make = lambda header, parent=None, order=0, **kw: Task.objects.create(
            header=header, parent=parent, order=order, duration=timedelta(hours=1), **kw)
        # T250 › Hardware Design › CAD, test prints ; T250 › Firmware ; Blog › Article ; Milk
        self.t250 = make("T250", order=0)
        self.hw = make("Hardware Design", self.t250, 0)
        self.cad = make("CAD", self.hw, 0)
        self.prints = make("test prints", self.hw, 1)
        self.fw = make("Firmware", self.t250, 1)
        self.blog = make("Company Blog", order=1)
        self.article = make("Article", self.blog, 0)
        self.milk = make("Buy milk", order=2)

    def move(self, task, parent, index):
        return self.client.post(f"/api/tasks/{task.id}/move/",
                                {"parent_id": str(parent.id) if parent else None, "index": index},
                                format="json")

    def children(self, parent):
        rows = Task.objects.filter(parent=parent).order_by("order", "header")
        return [(t.header, t.order) for t in rows]


class MoveTest(MoveTestBase):
    def test_reorders_within_a_level(self):
        response = self.move(self.prints, self.hw, 0)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.children(self.hw), [("test prints", 0), ("CAD", 1)])

    def test_moves_into_another_parent_at_a_position(self):
        response = self.move(self.fw, self.hw, 1)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.children(self.hw), [("CAD", 0), ("Firmware", 1), ("test prints", 2)])
        self.assertEqual(self.children(self.t250), [("Hardware Design", 0)])
        self.assertEqual(response.data["task"]["parent_id"], self.hw.id)
        self.assertEqual(response.data["task"]["order"], 1)

    def test_moves_to_the_top_level(self):
        response = self.move(self.cad, None, 0)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.children(None),
                         [("CAD", 0), ("T250", 1), ("Company Blog", 2), ("Buy milk", 3)])
        self.assertEqual(self.children(self.hw), [("test prints", 0)])

    def test_an_index_past_the_end_appends(self):
        self.assertEqual(self.move(self.milk, self.blog, 99).status_code, 200)
        self.assertEqual(self.children(self.blog), [("Article", 0), ("Buy milk", 1)])

    def test_moving_down_within_a_level_counts_positions_without_the_task(self):
        # index = position among the siblings once the task is taken out.
        self.move(self.t250, None, 1)
        self.assertEqual(self.children(None), [("Company Blog", 0), ("T250", 1), ("Buy milk", 2)])

    def test_recalculates_the_plan_once(self):
        with mock.patch("tasks.api.recalculate_accepted_plan") as recalculate:
            self.move(self.fw, self.hw, 0)
        self.assertEqual(recalculate.call_count, 1)


class MoveRefusalTest(MoveTestBase):
    def test_not_into_its_own_subtree(self):
        response = self.move(self.t250, self.cad, 0)
        self.assertEqual(response.status_code, 400)
        self.assertIn("is part of “T250”", response.data["parent_id"][0])
        self.assertEqual(response.data["path"], [str(self.t250.id), str(self.hw.id), str(self.cad.id)])
        self.assertEqual(self.children(self.hw), [("CAD", 0), ("test prints", 1)])  # unchanged

    def test_not_into_itself(self):
        response = self.move(self.hw, self.hw, 0)
        self.assertEqual(response.status_code, 400)
        self.assertIn("own parent", response.data["parent_id"][0])

    def test_not_when_it_creates_a_dependency_cycle(self):
        TaskDependency.objects.create(predecessor=self.cad, successor=self.fw)
        # Firmware inside CAD would have to finish before CAD can finish.
        response = self.move(self.fw, self.cad, 0)
        self.assertEqual(response.status_code, 400)
        self.assertIn("dependency cycle", response.data["parent_id"][0])
        self.assertIn("cycle", response.data)

    def test_not_a_completed_task(self):
        self.prints.completed_at = timezone.now()
        self.prints.save()
        response = self.move(self.prints, self.blog, 0)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Reopen it first", response.data["detail"])

    def test_not_into_a_completed_task(self):
        self.article.completed_at = timezone.now()
        self.article.save()
        self.blog.completed_at = timezone.now()
        self.blog.save()
        response = self.move(self.milk, self.blog, 0)
        self.assertEqual(response.status_code, 400)
        self.assertIn("“Company Blog” is completed", response.data["parent_id"][0])

    def test_index_must_not_be_negative_and_parent_must_exist(self):
        self.assertEqual(self.move(self.milk, self.blog, -1).status_code, 400)
        response = self.client.post(f"/api/tasks/{self.milk.id}/move/",
                                    {"parent_id": "00000000-0000-0000-0000-000000000000", "index": 0},
                                    format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.post(f"/api/tasks/{self.milk.id}/move/", {}, format="json").status_code, 400)


class ParentKeepsOpenTest(MoveTestBase):
    """Moving the last subtask away never closes the parent (docs/tasks-tab.md §2)."""

    def test_parent_without_subtasks_stays_open_and_is_planned(self):
        self.move(self.article, None, 0)
        self.blog.refresh_from_db()
        self.assertIsNone(self.blog.completed_at)
        planned = {unit.header for unit in build_planning_tasks(Task.objects.filter(completed_at=None))}
        self.assertIn("Company Blog", planned)  # a leaf again, with its own estimate

    def test_parent_with_only_completed_subtasks_left_stays_open(self):
        self.prints.completed_at = timezone.now()
        self.prints.save()
        response = self.move(self.cad, self.fw, 0)
        self.assertEqual(response.status_code, 200, response.data)
        self.hw.refresh_from_db()
        self.assertIsNone(self.hw.completed_at)

    def test_an_active_sub_project_that_loses_its_subtasks_hands_over(self):
        activate(self.hw)  # a project only because it has subtasks
        self.move(self.cad, self.fw, 0)
        self.assertEqual(get_settings().active_task, self.hw)  # still has "test prints"
        self.move(self.prints, self.fw, 0)
        self.assertEqual(get_settings().active_task, self.t250)  # nearest project above
