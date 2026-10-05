"""UI-3: starting a task while another one runs switches over (§3.2)."""
from datetime import timedelta

from tasks.tests.support import TestCase
from django.utils import timezone
from tasks.tests.support import APIClient

from tasks.models import Task, TrackingSession
from tasks.services.settings import get_settings
from tasks.services.tracking import start_tracking


class TrackingSwitchTest(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.t250 = Task.objects.create(header="T250")
        self.hardware = Task.objects.create(header="Hardware Design", parent=self.t250)
        self.cad = Task.objects.create(header="CAD", parent=self.hardware,
                                       duration=timedelta(hours=3))
        self.blog = Task.objects.create(header="Company Blog")
        self.article = Task.objects.create(header="Write article", parent=self.blog,
                                           duration=timedelta(hours=2))

    def test_starting_b_while_a_runs_books_a_and_runs_b(self):
        start_tracking(self.cad, now=self.now)
        session, stopped = start_tracking(self.article, now=self.now + timedelta(minutes=37))

        self.cad.refresh_from_db()
        self.assertEqual(self.cad.time_spent, timedelta(minutes=37))
        self.assertEqual(stopped, self.cad)
        self.assertEqual(session.task, self.article)
        self.assertEqual(TrackingSession.objects.filter(end=None).count(), 1)

    def test_starting_the_running_task_again_changes_nothing(self):
        first, _ = start_tracking(self.cad, now=self.now)
        again, stopped = start_tracking(self.cad, now=self.now + timedelta(minutes=5))
        self.assertEqual(first, again)
        self.assertIsNone(stopped)

    def test_active_project_follows_the_tracked_task(self):
        start_tracking(self.cad, now=self.now)
        self.assertEqual(get_settings().active_task, self.hardware)  # nearest parent
        start_tracking(self.article, now=self.now + timedelta(minutes=1))
        self.assertEqual(get_settings().active_task, self.blog)

    def test_tracking_a_parent_makes_it_the_active_project(self):
        start_tracking(self.hardware, now=self.now)  # e.g. ▶ on its Rest
        self.assertEqual(get_settings().active_task, self.hardware)

    def test_tracking_a_top_level_task_makes_it_the_active_project(self):
        milk = Task.objects.create(header="Buy milk", duration=timedelta(minutes=15))
        start_tracking(milk, now=self.now)
        self.assertEqual(get_settings().active_task, milk)

    def test_blocked_start_keeps_the_running_session(self):
        from tasks.models import TaskDependency
        from tasks.services.tracking import UnfinishedPredecessors
        blocker = Task.objects.create(header="Blocker", duration=timedelta(hours=1))
        TaskDependency.objects.create(predecessor=blocker, successor=self.article)
        start_tracking(self.cad, now=self.now)
        with self.assertRaises(UnfinishedPredecessors):
            start_tracking(self.article, now=self.now + timedelta(minutes=5))
        self.assertTrue(TrackingSession.objects.filter(task=self.cad, end=None).exists())

    def test_endpoint_reports_the_stopped_task_and_the_settings(self):
        client = APIClient()
        client.post(f"/api/tasks/{self.cad.id}/track/start/")
        response = client.post(f"/api/tasks/{self.article.id}/track/start/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["stopped_task_id"], self.cad.id)
        self.assertEqual(response.data["settings"]["active_task_id"], self.blog.id)
        self.assertIsNotNone(response.data["task"]["active_tracking_start"])
