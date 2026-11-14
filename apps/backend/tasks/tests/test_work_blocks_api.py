"""Sorting tracked time afterwards through the API (docs/sort-time.md, S5):
``/api/work-blocks/``."""
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model

from tasks.models import Task, TrackingSession, WorkBlock
from tasks.tests.support import APIClient, TestCase
from tasks.tests.test_work_blocks import at, minutes


class WorkBlockApiTest(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.now = at(13)
        self.clock = mock.patch("django.utils.timezone.now", side_effect=lambda: self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.a = Task.objects.create(header="Header", duration=minutes(60))
        self.b = Task.objects.create(header="Footer", duration=minutes(30))

    def post(self, path, body=None):
        return self.api.post(f"/api/work-blocks/{path}", body or {}, format="json")

    def items(self, *specs):
        return [{"task_id": str(task.id), "completed": True, "pinned_minutes": None, **extra} for task, extra in specs]

    def test_fill_a_gap(self):
        response = self.post("", {"start": at(9).isoformat(), "end": at(12).isoformat(),
                                   "items": self.items((self.a, {}), (self.b, {"pinned_minutes": 30}))})
        self.assertEqual(response.status_code, 201, response.data)
        block = response.data
        self.assertEqual((block["origin"], block["running"], block["seconds"]), ("gap", False, 3 * 3600))
        self.assertEqual([(item["header"], item["seconds"], item["pinned_minutes"], item["weight_minutes"])
                          for item in block["items"]], [("Header", 9000, None, 60), ("Footer", 1800, 30, 30)])
        self.assertTrue(Task.objects.get(id=self.b.id).is_done)

    def test_a_new_task_in_the_sheet(self):
        response = self.post("", {"start": at(9).isoformat(), "end": at(10).isoformat(), "items": [
            {"new": {"header": "Hotfix", "duration": "00:45:00", "tag_ids": [], "parent_id": None},
             "completed": True, "pinned_minutes": None}]})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["items"][0]["header"], "Hotfix")
        self.assertTrue(response.data["items"][0]["created_here"])

    def test_split_a_session_sort_again_and_undo(self):
        session = TrackingSession.objects.create(task=self.a, start=at(9), end=at(12))
        self.a.time_spent = minutes(180)
        self.a.save()
        response = self.post("", {"session_id": str(session.id), "items": self.items((self.a, {}), (self.b, {}))})
        self.assertEqual(response.status_code, 201, response.data)
        block_id = response.data["id"]
        self.assertEqual(response.data["origin"], "split")

        response = self.post(f"{block_id}/sort/", {"items": self.items((self.b, {}))})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Task.objects.get(id=self.b.id).time_spent, minutes(180))

        self.assertEqual(self.api.delete(f"/api/work-blocks/{block_id}/").status_code, 204)
        self.assertEqual(Task.objects.get(id=self.a.id).time_spent, minutes(180))
        self.assertEqual(Task.objects.get(id=self.b.id).time_spent, timedelta(0))

    def test_start_work_list_and_stop(self):
        self.now = at(8, 47)
        response = self.post("start/")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["running"])
        self.now = at(11)
        self.assertEqual([b["running"] for b in self.api.get("/api/work-blocks/").data], [True])

        response = self.post("stop/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.data["running"], response.data["sorted_at"]), (False, None))
        # Listed until sorted.
        [listed] = self.api.get("/api/work-blocks/").data
        self.assertEqual(listed["seconds"], int(timedelta(hours=2, minutes=13).total_seconds()))
        self.post(f"{listed['id']}/sort/", {"items": self.items((self.a, {}))})
        self.assertEqual(self.api.get("/api/work-blocks/").data, [])
        sorted_ones = self.api.get("/api/work-blocks/?from=2026-11-16&to=2026-11-16").data
        self.assertEqual(len(sorted_ones), 1)

    def test_a_short_start_is_dropped(self):
        self.post("start/")
        self.now = at(13) + timedelta(seconds=20)
        self.assertEqual(self.post("stop/").status_code, 204)

    def test_refusals_say_why(self):
        TrackingSession.objects.create(task=self.b, start=at(10), end=at(11))
        response = self.post("", {"start": at(9).isoformat(), "end": at(12).isoformat(),
                                   "items": self.items((self.a, {}))})
        self.assertEqual(response.status_code, 400)
        self.assertIn("overlaps “Footer”", response.data["detail"])
        response = self.post("", {"start": at(11).isoformat(), "end": at(12).isoformat(),
                                   "items": self.items((self.a, {"pinned_minutes": 90}))})
        self.assertIn("more than", response.data["detail"])
        self.assertEqual(self.post("", {"items": []}).status_code, 400)
        self.assertEqual(self.post("stop/").status_code, 400)

    def test_stopping_and_completing_say_which_session_closed(self):
        self.now = at(9)
        self.api.post(f"/api/tasks/{self.a.id}/track/start/")
        self.now = at(11)
        session = self.api.post(f"/api/tasks/{self.a.id}/track/stop/").data["session"]
        self.assertEqual((session["seconds"], str(session["task_id"])), (7200, str(self.a.id)))
        self.api.post(f"/api/tasks/{self.b.id}/track/start/")
        self.now = at(12)
        session = self.api.post(f"/api/tasks/{self.b.id}/complete/").data["session"]
        self.assertEqual(session["seconds"], 3600)
        self.assertIsNone(self.api.post(f"/api/tasks/{self.a.id}/complete/").data["session"])

    def test_sessions_say_when_they_were_shared_out(self):
        self.post("", {"start": at(9).isoformat(), "end": at(10).isoformat(), "items": self.items((self.a, {}))})
        [session] = self.api.get(f"/api/sessions/?task={self.a.id}").data
        self.assertTrue(session["apportioned"])
        self.assertIsNotNone(session["block_id"])

    def test_another_users_blocks_stay_theirs(self):
        block = WorkBlock.objects.create(start=at(9), end=at(10), origin="started")
        other = APIClient()
        other.force_login(get_user_model().objects.create_user("other"))
        self.assertEqual(other.get("/api/work-blocks/").data, [])
        self.assertEqual(other.delete(f"/api/work-blocks/{block.id}/").status_code, 404)
