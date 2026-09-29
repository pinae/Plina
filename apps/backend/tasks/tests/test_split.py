"""UI-3: POST /api/tasks/{id}/split/ — the split editor's atomic save.

The request lists the complete new set of direct subtasks in order; rows
with an ``id`` update an existing subtask, rows without create one, and
existing subtasks that are left out are removed. Everything happens in one
transaction: any validation error leaves the tree untouched.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Tag, Task, TaskDependency, TaskEstimateChange


def hours(n):
    return timedelta(hours=n)


class SplitTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.maker = Tag.objects.create(name="maker")
        self.hardware = Task.objects.create(header="Hardware Design", duration=hours(12), priority=7)
        self.hardware.tags.add(self.maker)

    def split(self, task, payload):
        return self.client.post(f"/api/tasks/{task.id}/split/", payload, format="json")

    def children(self, task):
        return list(Task.objects.filter(parent=task).order_by("order"))

    def test_fresh_split_creates_ordered_children_with_a_chain(self):
        response = self.split(self.hardware, {"sequential": True, "children": [
            {"header": "CAD", "duration": "03:00:00"},
            {"header": "test prints", "duration": "02:00:00"},
            {"header": "component orders"},  # unestimated
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        cad, prints, orders = self.children(self.hardware)
        self.assertEqual([c.header for c in (cad, prints, orders)],
                         ["CAD", "test prints", "component orders"])
        self.assertEqual((cad.duration, orders.duration), (hours(3), None))
        self.assertEqual(set(TaskDependency.objects.values_list("predecessor", "successor")),
                         {(cad.id, prints.id), (prints.id, orders.id)})
        # Inherited from the parent by default.
        self.assertEqual(list(cad.tags.all()), [self.maker])
        self.assertEqual(cad.priority, 7)
        # The parent's estimate stays a budget.
        self.hardware.refresh_from_db()
        self.assertEqual(self.hardware.duration, hours(12))
        self.assertEqual(len(response.data["task"]["children_ids"]), 3)
        self.assertEqual([c["header"] for c in response.data["children"]],
                         ["CAD", "test prints", "component orders"])
        self.assertEqual(TaskEstimateChange.objects.filter(task=cad, reason="created").count(), 1)

    def test_not_sequential_creates_no_dependencies(self):
        self.split(self.hardware, {"sequential": False, "children": [
            {"header": "a", "duration": "01:00:00"}, {"header": "b", "duration": "01:00:00"},
        ]})
        self.assertFalse(TaskDependency.objects.exists())

    def test_inheritance_can_be_switched_off_and_overridden(self):
        other = Tag.objects.create(name="other")
        self.split(self.hardware, {"inherit_tags": False, "inherit_priority": False, "children": [
            {"header": "plain"},
            {"header": "tagged", "tag_ids": [str(other.id)], "priority": 2},
        ]})
        plain, tagged = self.children(self.hardware)
        self.assertEqual(list(plain.tags.all()), [])
        self.assertEqual(plain.priority, 5.0)
        self.assertEqual((list(tagged.tags.all()), tagged.priority), ([other], 2))

    def test_new_estimate_is_recorded_with_its_reason(self):
        response = self.split(self.hardware, {
            "estimate": "10:00:00", "estimate_reason": "set_to_sum",
            "children": [{"header": "CAD", "duration": "10:00:00"}],
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.hardware.refresh_from_db()
        self.assertEqual(self.hardware.duration, hours(10))
        change = TaskEstimateChange.objects.get(task=self.hardware)
        self.assertEqual((change.reason, change.old_duration, change.new_duration),
                         ("set_to_sum", hours(12), hours(10)))

    def test_editing_existing_parts_updates_reorders_adds_and_removes(self):
        cad = Task.objects.create(header="CAD", duration=hours(3), parent=self.hardware, order=0)
        prints = Task.objects.create(header="prints", duration=hours(2), parent=self.hardware, order=1)
        obsolete = Task.objects.create(header="obsolete", parent=self.hardware, order=2)
        response = self.split(self.hardware, {"sequential": False, "children": [
            {"id": str(prints.id), "header": "test prints", "duration": "02:00:00"},
            {"id": str(cad.id), "header": "CAD", "duration": "04:00:00"},
            {"header": "assembly", "duration": "02:00:00"},
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([c.header for c in self.children(self.hardware)],
                         ["test prints", "CAD", "assembly"])
        self.assertFalse(Task.objects.filter(id=obsolete.id).exists())
        cad.refresh_from_db()
        self.assertEqual(cad.duration, hours(4))
        self.assertEqual(TaskEstimateChange.objects.get(task=cad).reason, "split")
        prints.refresh_from_db()
        self.assertEqual(prints.header, "test prints")

    def test_nested_rows_split_their_row(self):
        response = self.split(self.hardware, {"sequential": False, "children": [
            {"header": "CAD", "duration": "03:00:00", "children": [
                {"header": "housing", "duration": "02:00:00"},
                {"header": "mount", "duration": "01:00:00"},
            ]},
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        (cad,) = self.children(self.hardware)
        self.assertEqual([c.header for c in self.children(cad)], ["housing", "mount"])
        self.assertEqual(list(self.children(cad)[0].tags.all()), [self.maker])

    def test_removing_a_part_with_tracked_time_is_refused_and_nothing_changes(self):
        cad = Task.objects.create(header="CAD", duration=hours(3), parent=self.hardware,
                                  time_spent=hours(1))
        response = self.split(self.hardware, {"children": [{"header": "new part"}]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("CAD", response.data["detail"])
        self.assertEqual(self.children(self.hardware), [cad])

    def test_a_task_from_elsewhere_cannot_be_pulled_in(self):
        stranger = Task.objects.create(header="stranger")
        response = self.split(self.hardware, {"children": [{"id": str(stranger.id), "header": "x"}]})
        self.assertEqual(response.status_code, 400)
        stranger.refresh_from_db()
        self.assertIsNone(stranger.parent_id)

    def test_a_cycle_from_the_chain_rolls_back_everything(self):
        cad = Task.objects.create(header="CAD", parent=self.hardware, order=0)
        prints = Task.objects.create(header="prints", parent=self.hardware, order=1)
        TaskDependency.objects.create(predecessor=prints, successor=cad)
        response = self.split(self.hardware, {"sequential": True, "children": [
            {"id": str(cad.id), "header": "CAD"},
            {"id": str(prints.id), "header": "prints"},
            {"header": "assembly"},
        ]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("cycle", response.data["detail"])
        self.assertEqual(self.children(self.hardware), [cad, prints])
        self.assertEqual(TaskDependency.objects.count(), 1)

    def test_row_errors_point_at_the_row(self):
        response = self.split(self.hardware, {"children": [
            {"header": "fine"}, {"header": ""},
        ]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("header", response.data["children"][1])
        self.assertFalse(Task.objects.filter(parent=self.hardware).exists())

    def test_a_completed_task_cannot_be_split(self):
        self.hardware.completed_at = timezone.now()
        self.hardware.save()
        response = self.split(self.hardware, {"children": [{"header": "late"}]})
        self.assertEqual(response.status_code, 400)


class SplitRestructureTest(TestCase):
    """UI-6: the editor can move existing subtasks between levels."""

    def setUp(self):
        self.client = APIClient()
        self.hardware = Task.objects.create(header="Hardware Design", duration=hours(12))
        self.cad = Task.objects.create(header="CAD", parent=self.hardware, order=0, duration=hours(3))
        self.housing = Task.objects.create(header="housing", parent=self.cad, order=0, duration=hours(2))
        self.mount = Task.objects.create(header="mount", parent=self.cad, order=1, duration=hours(1))

    def split(self, payload):
        return self.client.post(f"/api/tasks/{self.hardware.id}/split/", payload, format="json")

    def test_outdenting_a_nested_part_moves_it_up(self):
        response = self.split({"sequential": False, "children": [
            {"id": str(self.cad.id), "header": "CAD", "duration": "03:00:00", "children": [
                {"id": str(self.housing.id), "header": "housing", "duration": "02:00:00"},
            ]},
            {"id": str(self.mount.id), "header": "mount", "duration": "01:00:00"},
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        self.mount.refresh_from_db()
        self.assertEqual((self.mount.parent_id, self.mount.order), (self.hardware.id, 1))

    def test_a_row_without_children_keeps_its_subtree(self):
        response = self.split({"sequential": False, "children": [
            {"id": str(self.cad.id), "header": "CAD v2", "duration": "03:00:00"},
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Task.objects.filter(parent=self.cad).count(), 2)

    def test_parts_missing_from_the_payload_are_removed_at_any_depth(self):
        response = self.split({"sequential": False, "children": [
            {"id": str(self.cad.id), "header": "CAD", "duration": "03:00:00", "children": [
                {"id": str(self.housing.id), "header": "housing", "duration": "02:00:00"},
            ]},
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Task.objects.filter(id=self.mount.id).exists())

    def test_rows_can_carry_a_deadline_within_the_ancestors(self):
        self.hardware.latest_finish_date = timezone.now() + timedelta(days=10)
        self.hardware.save()
        ok = timezone.now() + timedelta(days=5)
        response = self.split({"children": [{"header": "orders", "latest_finish_date": ok.isoformat()}]})
        self.assertEqual(response.status_code, 200, response.data)
        late = timezone.now() + timedelta(days=20)
        response = self.split({"children": [{"header": "late", "latest_finish_date": late.isoformat()}]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Hardware Design", response.data["detail"])

    def test_a_move_that_creates_a_dependency_cycle_rolls_back(self):
        # CAD's whole subtree waits for "order filament", which waits for
        # "second". Moving "second" into CAD would make it wait for itself.
        outside = Task.objects.create(header="order filament")
        second = Task.objects.create(header="second", parent=self.hardware, order=1)
        TaskDependency.objects.create(predecessor=outside, successor=self.cad)
        TaskDependency.objects.create(predecessor=second, successor=outside)
        response = self.split({"sequential": False, "children": [
            {"id": str(self.cad.id), "header": "CAD", "children": [
                {"id": str(self.housing.id), "header": "housing"},
                {"id": str(self.mount.id), "header": "mount"},
                {"id": str(second.id), "header": "second"},  # moved into CAD → cycle
            ]},
        ]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("cycle", response.data["detail"])
        second.refresh_from_db()
        self.assertEqual(second.parent_id, self.hardware.id)
