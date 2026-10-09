"""UI-3: user settings (default duration, server-synced active project)."""
from datetime import timedelta

from tasks.tests.support import TestCase
from django.utils import timezone
from tasks.tests.support import APIClient

from tasks.models import Task, TimeBucketType
from tasks.services.planner_service import build_planning_tasks
from tasks.services.settings import get_settings


class SettingsApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_defaults(self):
        response = self.client.get("/api/settings/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["default_duration"], "01:00:00")
        self.assertIsNone(response.data["active_task_id"])
        self.assertEqual(response.data["active_task_path"], [])

    def test_changing_the_default_duration(self):
        response = self.client.patch("/api/settings/", {"default_duration": "00:30:00"},
                                     format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(get_settings().default_duration, timedelta(minutes=30))

    def test_default_duration_must_be_positive(self):
        response = self.client.patch("/api/settings/", {"default_duration": "00:00:00"},
                                     format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("default_duration", response.data)

    def test_active_project_with_breadcrumb_path(self):
        t250 = Task.objects.create(header="T250")
        hardware = Task.objects.create(header="Hardware Design", parent=t250)
        Task.objects.create(header="CAD", parent=hardware)
        response = self.client.patch("/api/settings/", {"active_task_id": str(hardware.id)},
                                     format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["active_task_id"], hardware.id)
        self.assertEqual(response.data["active_task_path"], [
            {"id": t250.id, "header": "T250"},
            {"id": hardware.id, "header": "Hardware Design"},
        ])

    def test_active_project_must_be_a_project(self):
        t250 = Task.objects.create(header="T250")
        cad = Task.objects.create(header="CAD", parent=t250)
        response = self.client.patch("/api/settings/", {"active_task_id": str(cad.id)},
                                     format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("active_task_id", response.data)

    def test_active_project_must_be_open(self):
        done = Task.objects.create(header="Old project", completed_at=timezone.now())
        response = self.client.patch("/api/settings/", {"active_task_id": str(done.id)},
                                     format="json")
        self.assertEqual(response.status_code, 400)

    def test_clearing_the_active_project(self):
        project = Task.objects.create(header="Blog")
        get_settings_obj = get_settings()
        get_settings_obj.active_task = project
        get_settings_obj.save()
        response = self.client.patch("/api/settings/", {"active_task_id": None}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(get_settings().active_task)

    def test_deleting_the_active_project_clears_it(self):
        project = Task.objects.create(header="Blog")
        settings = get_settings()
        settings.active_task = project
        settings.save()
        project.delete()
        self.assertIsNone(get_settings().active_task)


class DefaultDurationPlanningTest(TestCase):
    """Acceptance scenario 4: unestimated tasks follow the user's default."""

    def test_unestimated_tasks_use_the_setting(self):
        task = Task.objects.create(header="Call landlord")
        settings = get_settings()
        settings.default_duration = timedelta(minutes=30)
        settings.save()
        snapshot = build_planning_tasks([task])[0]
        self.assertEqual(snapshot.remaining_duration, timedelta(minutes=30))

    def test_parts_and_rest_use_the_setting(self):
        parent = Task.objects.create(header="P", duration=timedelta(hours=2))
        Task.objects.create(header="a", parent=parent)
        settings = get_settings()
        settings.default_duration = timedelta(minutes=30)
        settings.save()
        data = APIClient().get(f"/api/tasks/{parent.id}/").data
        self.assertEqual(data["parts_total"], "00:30:00")
        self.assertEqual(data["rest"], "01:30:00")

    def test_a_new_default_reaches_the_accepted_plan_on_replan(self):
        client = APIClient()
        TimeBucketType.objects.create(name="Daily", start_times="every day at 09:00",
                                      duration=timedelta(hours=4))
        task = Task.objects.create(header="Call landlord")
        plan = client.post("/api/plan/alternatives/").data["alternatives"][0]
        client.post(f"/api/plans/{plan['id']}/accept/")

        def planned(data):
            return sum(item["duration"] for bucket in data["buckets"]
                       for item in bucket["items"] if item["task_id"] == task.id)

        client.patch("/api/settings/", {"default_duration": "00:30:00"}, format="json")
        self.assertEqual(planned(client.get("/api/plan/").data), 60 * 60)  # README: Planning light
        self.assertEqual(planned(client.post("/api/plan/recalculate/").data), 30 * 60)


class ActiveProjectAfterCompletionTest(TestCase):
    def test_completed_active_project_moves_to_the_nearest_open_ancestor(self):
        t250 = Task.objects.create(header="T250")
        hardware = Task.objects.create(header="Hardware Design", parent=t250)
        cad = Task.objects.create(header="CAD", parent=hardware)
        Task.objects.create(header="Firmware", parent=t250)
        settings = get_settings()
        settings.active_task = hardware
        settings.save()
        APIClient().post(f"/api/tasks/{cad.id}/complete/")  # completes Hardware Design too
        self.assertEqual(get_settings().active_task, t250)
