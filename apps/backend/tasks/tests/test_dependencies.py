from datetime import timedelta

from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from tasks.models import Task, TaskDependency
from tasks.services.graph import would_create_cycle


class TaskDependencyModelTest(TestCase):
    def setUp(self):
        self.task_a = Task.objects.create(header="A")
        self.task_b = Task.objects.create(header="B")

    def test_create_dependency(self):
        dep = TaskDependency.objects.create(
            predecessor=self.task_a, successor=self.task_b
        )
        self.assertIn(dep, self.task_a.outgoing_dependencies.all())
        self.assertIn(dep, self.task_b.incoming_dependencies.all())

    def test_duplicate_edge_violates_db_constraint(self):
        TaskDependency.objects.create(predecessor=self.task_a, successor=self.task_b)
        with self.assertRaises(IntegrityError), transaction.atomic():
            TaskDependency.objects.create(
                predecessor=self.task_a, successor=self.task_b
            )

    def test_self_edge_violates_db_constraint(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            TaskDependency.objects.create(
                predecessor=self.task_a, successor=self.task_a
            )

    def test_deleting_a_task_cascades_its_edges(self):
        TaskDependency.objects.create(predecessor=self.task_a, successor=self.task_b)
        self.task_a.delete()
        self.assertEqual(TaskDependency.objects.count(), 0)


class DependencyApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.task_a = Task.objects.create(header="A")
        self.task_b = Task.objects.create(header="B")
        self.task_c = Task.objects.create(header="C")

    def _create(self, predecessor, successor):
        return self.client.post(
            "/api/dependencies/",
            {"predecessor": str(predecessor.id), "successor": str(successor.id)},
            format="json",
        )

    def test_create_and_list(self):
        response = self._create(self.task_a, self.task_b)
        self.assertEqual(response.status_code, 201)

        response = self.client.get("/api/dependencies/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["predecessor"], self.task_a.id)
        self.assertEqual(response.data[0]["successor"], self.task_b.id)

    def test_self_edge_is_rejected(self):
        response = self._create(self.task_a, self.task_a)
        self.assertEqual(response.status_code, 400)

    def test_duplicate_edge_is_rejected(self):
        self._create(self.task_a, self.task_b)
        response = self._create(self.task_a, self.task_b)
        self.assertEqual(response.status_code, 400)

    def test_cycle_is_rejected_with_the_full_path(self):
        self.assertEqual(self._create(self.task_a, self.task_b).status_code, 201)
        self.assertEqual(self._create(self.task_b, self.task_c).status_code, 201)

        response = self._create(self.task_c, self.task_a)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data["cycle"],
            [str(self.task_a.id), str(self.task_b.id),
             str(self.task_c.id), str(self.task_a.id)],
        )

    def test_delete_dependency(self):
        create_response = self._create(self.task_a, self.task_b)
        dependency_id = create_response.data["id"]

        response = self.client.delete(f"/api/dependencies/{dependency_id}/")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(TaskDependency.objects.count(), 0)

    def test_update_is_not_allowed(self):
        create_response = self._create(self.task_a, self.task_b)
        dependency_id = create_response.data["id"]

        response = self.client.patch(
            f"/api/dependencies/{dependency_id}/",
            {"successor": str(self.task_c.id)},
            format="json",
        )

        self.assertEqual(response.status_code, 405)


class DemoDataDependenciesTest(TestCase):
    def test_demo_data_contains_an_acyclic_dependency_graph(self):
        call_command("populate_demo_data", verbosity=0)

        edges = list(
            TaskDependency.objects.values_list("predecessor_id", "successor_id")
        )
        self.assertGreaterEqual(len(edges), 6)
        for edge in edges:
            remaining = [e for e in edges if e != edge]
            self.assertIsNone(
                would_create_cycle(remaining, edge),
                f"Demo data contains a cycle through edge {edge}",
            )
