"""The task list (GET /api/tasks/) loads every task the frontend shows; it is
fetched again after each change (README: Performance). Its number of
database queries must not grow with the number of tasks: one query per
task (its tags, its running session) cost about half a second for 450
tasks."""
from datetime import timedelta

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from tasks.models import Tag, Task, TrackingSession
from tasks.tests.support import APIClient, TestCase


class TaskListQueriesTest(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.maker = Tag.objects.create(name="maker")
        self.writing = Tag.objects.create(name="writing")
        self.project = Task.objects.create(header="Project")

    def add_tasks(self, count):
        for index in range(count):
            task = Task.objects.create(header=f"Task {Task.objects.count()}", parent=self.project, order=index,
                                       duration=timedelta(minutes=30))
            task.tags.add(self.maker if index % 2 else self.writing)
            if index % 3 == 0:
                TrackingSession.objects.create(task=task, start=timezone.now() - timedelta(hours=3),
                                               end=timezone.now() - timedelta(hours=2))

    def queries_for_list(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.api.get("/api/tasks/")
        self.assertEqual(response.status_code, 200)
        return len(queries.captured_queries), response.json()

    def test_the_number_of_queries_does_not_grow_with_the_tasks(self):
        self.add_tasks(5)
        few, _ = self.queries_for_list()
        self.add_tasks(20)
        many, tasks = self.queries_for_list()

        self.assertEqual(len(tasks), 26)
        self.assertEqual(many, few)

    def test_tags_and_the_running_session_are_still_listed(self):
        self.add_tasks(4)
        running = Task.objects.get(header="Task 2")
        start = timezone.now() - timedelta(minutes=20)
        TrackingSession.objects.create(task=running, start=start)

        _, tasks = self.queries_for_list()

        by_header = {task["header"]: task for task in tasks}
        self.assertEqual([tag["name"] for tag in by_header["Task 2"]["tags"]], ["maker"])
        self.assertEqual([tag["name"] for tag in by_header["Task 1"]["tags"]], ["writing"])
        self.assertIsNotNone(by_header["Task 2"]["active_tracking_start"])
        self.assertEqual(
            [header for header, task in by_header.items() if task["active_tracking_start"]], ["Task 2"])

    def test_a_single_task_still_shows_its_running_session(self):
        task = Task.objects.create(header="CAD")
        TrackingSession.objects.create(task=task, start=timezone.now() - timedelta(minutes=5))
        self.assertIsNotNone(self.api.get(f"/api/tasks/{task.id}/").json()["active_tracking_start"])
