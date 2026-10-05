"""Every user has their own data (README: Accounts): logged out, no API
endpoint answers with data; logged in, nobody sees, changes or uses another
user's tasks, tags, time buckets, dependencies, plans or settings."""
import re
from datetime import timedelta
from uuid import uuid4

from django.contrib.auth.models import User
from django.test import Client
from django.urls import URLPattern, URLResolver, get_resolver
from django.utils import timezone

from plina.scoping import owner_scope
from tasks.models import Plan, Tag, Task, TaskDependency, TimeBucket, TimeBucketType
from tasks.tests.support import APIClient, TestCase

PUBLIC = {"/api/auth/session/", "/api/auth/login/"}


def api_paths(patterns=None, prefix=""):
    """Every API URL, with a made-up id where one goes."""
    for pattern in patterns if patterns is not None else get_resolver().url_patterns:
        route = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            yield from api_paths(pattern.url_patterns, route)
        elif isinstance(pattern, URLPattern) and "format" not in route:
            path = re.sub(r"\(\?P<\w+>[^)]*\)|<\w+(:\w+)?>", str(uuid4()), route)
            path = "/" + path.replace("^", "").replace("$", "").replace("\\", "")
            if path.startswith("/api/"):
                yield path


class LoggedOutTest(TestCase):
    def test_every_api_endpoint_needs_a_login(self):
        client = Client()  # not logged in
        paths = sorted(set(api_paths()))
        self.assertGreater(len(paths), 20)
        for path in paths:
            for method in ("get", "post", "patch", "put", "delete"):
                status = getattr(client, method)(path, content_type="application/json").status_code
                if path in PUBLIC:
                    continue
                self.assertIn(status, (401, 405), f"{method.upper()} {path} answered {status}")


class TwoUsersTest(TestCase):
    """Alice (the test's user) has data; Bob must not reach any of it."""

    def setUp(self):
        self.alice = APIClient()
        self.bob_user = User.objects.create_user("bob")
        self.bob = APIClient()
        self.bob.force_login(self.bob_user)
        alice = self.alice
        self.tag = alice.post("/api/tags/", {"name": "maker"}, format="json").data["id"]
        self.bucket_type = alice.post("/api/buckettypes/", {
            "name": "Deep work", "start_times": "every day at 09:00", "duration": "04:00:00",
            "tag_ids": [self.tag]}, format="json").data["id"]
        start = (timezone.now() + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        self.bucket = alice.post("/api/timebuckets/", {
            "start_date": start.isoformat(), "duration": "02:00:00", "type_id": self.bucket_type},
            format="json").data["id"]
        self.project = alice.post("/api/tasks/", {"header": "T250", "duration": "05:00:00"}, format="json").data["id"]
        self.step = alice.post("/api/tasks/", {"header": "CAD", "parent_id": self.project, "duration": "01:00:00",
                                               "tag_ids": [self.tag]}, format="json").data["id"]
        self.other = alice.post("/api/tasks/", {"header": "Print", "parent_id": self.project,
                                                "duration": "01:00:00"}, format="json").data["id"]
        self.dependency = alice.post("/api/dependencies/", {"predecessor": self.step, "successor": self.other},
                                     format="json").data["id"]
        alice.patch("/api/settings/", {"time_zone": "Europe/Berlin", "active_task_id": self.project}, format="json")
        alice.post(f"/api/tasks/{self.step}/track/start/")
        plans = alice.post("/api/plan/alternatives/").data["alternatives"]
        self.plan = str(plans[0]["id"])
        alice.post(f"/api/plans/{self.plan}/accept/")
        self.snapshot = self.alices_data()

    def alices_data(self):
        with owner_scope(self.user):
            return {
                "tasks": sorted((t.header, t.parent_id, t.duration, t.priority) for t in Task.objects.all()),
                "tags": sorted(t.name for t in Tag.objects.all()),
                "types": sorted(t.name for t in TimeBucketType.objects.all()),
                "buckets": TimeBucket.objects.count(),
                "dependencies": TaskDependency.objects.count(),
                "plans": sorted((str(p.id), p.is_accepted) for p in Plan.objects.all()),
                "settings": self.alice.get("/api/settings/").data,
            }

    def test_bob_sees_none_of_it(self):
        for path in ("/api/tasks/", "/api/tags/", "/api/buckettypes/", "/api/timebuckets/",
                     "/api/dependencies/", "/api/plans/"):
            self.assertEqual(self.bob.get(path).data, [], path)
        plan = self.bob.get("/api/plan/").data
        self.assertIsNone(plan["accepted_plan_id"])
        self.assertEqual((plan["appointments"], plan["buckets"]), ([], []))
        settings = self.bob.get("/api/settings/").data
        self.assertEqual((settings["time_zone"], settings["active_task_id"]), ("", None))

    def test_bob_cannot_read_change_or_delete_any_of_it_by_id(self):
        objects = {"tasks": [self.project, self.step], "tags": [self.tag], "buckettypes": [self.bucket_type],
                   "timebuckets": [self.bucket], "dependencies": [self.dependency], "plans": [self.plan]}
        for collection, ids in objects.items():
            for object_id in ids:
                path = f"/api/{collection}/{object_id}/"
                self.assertEqual(self.bob.get(path).status_code, 404, path)
                self.assertIn(self.bob.patch(path, {"header": "Bob was here", "name": "Bob"},
                                             format="json").status_code, (404, 405), path)
                self.assertIn(self.bob.delete(path).status_code, (404, 405), path)
        for action in ("track/start", "track/stop", "complete", "reopen", "split", "move"):
            response = self.bob.post(f"/api/tasks/{self.step}/{action}/", {"children": [], "parent_id": None,
                                                                            "index": 0}, format="json")
            self.assertEqual(response.status_code, 404, action)
        self.assertEqual(self.bob.post(f"/api/plans/{self.plan}/accept/").status_code, 404)
        self.assertEqual(self.alices_data(), self.snapshot)

    def test_bob_cannot_use_her_objects_in_his(self):
        attempts = [
            ("/api/tasks/", {"header": "Into her project", "parent_id": self.project}),
            ("/api/tasks/", {"header": "With her tag", "tag_ids": [self.tag]}),
            ("/api/dependencies/", {"predecessor": self.step, "successor": self.other}),
            ("/api/timebuckets/", {"start_date": timezone.now().isoformat(), "duration": "01:00:00",
                                   "type_id": self.bucket_type}),
            ("/api/buckettypes/", {"name": "With her tag", "start_times": "", "duration": "01:00:00",
                                   "tag_ids": [self.tag]}),
        ]
        for path, body in attempts:
            self.assertEqual(self.bob.post(path, body, format="json").status_code, 400, (path, body))
        own = self.bob.post("/api/tasks/", {"header": "Bob's"}, format="json").data["id"]
        self.assertEqual(self.bob.post("/api/dependencies/", {"predecessor": own, "successor": self.step},
                                       format="json").status_code, 400)
        self.assertEqual(self.bob.post(f"/api/tasks/{own}/move/", {"parent_id": self.project, "index": 0},
                                       format="json").status_code, 400)
        self.assertEqual(self.bob.patch("/api/settings/", {"active_task_id": self.project},
                                        format="json").status_code, 400)
        self.assertEqual(self.alices_data(), self.snapshot)

    def test_each_plans_their_own_week(self):
        own = self.bob.post("/api/tasks/", {"header": "Bob's work", "duration": "01:00:00"}, format="json").data["id"]
        self.bob.post("/api/buckettypes/", {"name": "Bob's time", "start_times": "every day at 13:00",
                                            "duration": "02:00:00"}, format="json")
        alternatives = self.bob.post("/api/plan/alternatives/").data["alternatives"]
        planned = {str(item["task_id"]) for alternative in alternatives for bucket in alternative["buckets"]
                   for item in bucket["items"]}
        self.assertEqual(planned, {own})
        types = {bucket["type_name"] for alternative in alternatives for bucket in alternative["buckets"]}
        self.assertEqual(types, {"Bob's time"})
        # Accepting his plan keeps hers (acceptance drops only one's own candidates).
        self.bob.post(f"/api/plans/{alternatives[0]['id']}/accept/")
        self.assertEqual(str(self.alice.get("/api/plan/").data["accepted_plan_id"]), self.plan)
        self.assertEqual(self.alices_data()["plans"], self.snapshot["plans"])

    def test_tracking_is_per_user(self):
        # Alice tracks CAD; Bob starting his own work does not stop hers.
        own = self.bob.post("/api/tasks/", {"header": "Bob's work"}, format="json").data["id"]
        response = self.bob.post(f"/api/tasks/{own}/track/start/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["stopped_task_id"])
        cad = self.alice.get(f"/api/tasks/{self.step}/").data
        self.assertIsNotNone(cad["active_tracking_start"])
