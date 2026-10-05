"""Recurring tasks through the API (README: Recurring tasks): the Repeats
field of the task form, “this occurrence” or “this and the following”,
deleting one or all occurrences, and the plan."""
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import override_settings

from tasks.models import Task, TaskSeries, TimeBucketType
from tasks.services.settings import get_settings
from tasks.tests.support import APIClient, TestCase

BERLIN = ZoneInfo("Europe/Berlin")
MONDAY = datetime(2026, 10, 5, 9, 0, tzinfo=BERLIN)


def at(day, hour=0, minute=0):
    return datetime(2026, 10, 1, hour, minute, tzinfo=BERLIN) + timedelta(days=day - 1)


def moment(value):
    return datetime.fromisoformat(value).astimezone(BERLIN) if value else None


# The clock is moved weeks ahead: the login must outlast it.
@override_settings(SESSION_COOKIE_AGE=365 * 24 * 3600)
class RecurringApiTestCase(TestCase):
    def setUp(self):
        settings = get_settings()
        settings.time_zone = "Europe/Berlin"
        settings.save()
        self.api = APIClient()
        self.now = MONDAY

    def at_time(self, when):
        self.now = when

    def request(self, method, path, body=None, **params):
        with mock.patch("django.utils.timezone.now", side_effect=lambda: self.now):
            return getattr(self.api, method)(path, body, format="json", **params)

    def create(self, **body):
        response = self.request("post", "/api/tasks/", body)
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def tasks(self, header=None):
        response = self.request("get", "/api/tasks/")
        self.assertEqual(response.status_code, 200)
        found = [task for task in response.data if header is None or task["header"] == header]
        return sorted(found, key=lambda task: task["occurrence"] or "")


class RepeatsFieldTest(RecurringApiTestCase):
    def test_a_task_that_repeats(self):
        chore = self.create(header="Water plants", duration="00:15:00", recurrence="every tuesday 20:00")
        self.assertEqual((chore["recurrence"], chore["recurrence_description"]),
                         ("every tuesday 20:00", "every Tuesday at 20:00"))
        self.assertEqual(moment(chore["occurrence"]), at(6, 20))
        self.assertEqual(moment(chore["next_occurrence"]), at(13, 20))
        self.assertEqual(chore["occurrence_count"], 1)
        self.assertTrue(chore["series_id"])
        plain = self.create(header="Once")
        self.assertEqual((plain["recurrence"], plain["series_id"], plain["occurrence"]), (None, None, None))

    def test_a_rule_plina_does_not_understand(self):
        response = self.request("post", "/api/tasks/", {"header": "Odd", "recurrence": "every sometimes"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("“sometimes”", response.data["recurrence"][0])
        self.assertFalse(Task.objects.filter(header="Odd").exists())

    def test_an_appointment_starts_on_the_rule(self):
        meeting = self.create(header="Jour fixe", is_appointment=True, duration="01:00:00",
                              start_date=at(5, 11).isoformat(), recurrence="every wednesday at 9:00")
        self.assertEqual(moment(meeting["start_date"]), at(7, 9))
        # Its occurrences for the planning horizon (60 days) are there.
        starts = [moment(task["start_date"]) for task in self.tasks("Jour fixe")]
        self.assertEqual(starts[:2], [at(7, 9), at(14, 9)])
        self.assertEqual(starts[-1], at(63, 9))  # Wednesday, 2 December

    def test_no_subtasks(self):
        chore = self.create(header="Water plants", recurrence="every tuesday 20:00")
        response = self.request("post", "/api/tasks/", {"header": "Balcony", "parent_id": chore["id"]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("cannot have subtasks", response.data["parent_id"][0])
        other = self.create(header="Balcony")
        response = self.request("post", f"/api/tasks/{other['id']}/move/", {"parent_id": chore["id"], "index": 0})
        self.assertEqual(response.status_code, 400)
        self.assertIn("cannot have subtasks", str(response.data))
        response = self.request("patch", f"/api/tasks/{other['id']}/", {"parent_id": chore["id"]})
        self.assertEqual(response.status_code, 400)
        response = self.request("post", f"/api/tasks/{chore['id']}/split/", {"children": [{"header": "A"}]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("cannot have subtasks", response.data["detail"])
        party = self.create(header="Party")
        self.create(header="Invite", parent_id=party["id"])
        response = self.request("patch", f"/api/tasks/{party['id']}/", {"recurrence": "every friday"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("subtasks", response.data["recurrence"][0])

    def test_the_preview(self):
        response = self.request("post", "/api/recurrence-preview/", {"recurrence": "every tuesday 20:00"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["description"], "every Tuesday at 20:00")
        self.assertEqual([moment(value) for value in response.data["occurrences"]][:2], [at(6, 20), at(13, 20)])
        response = self.request("post", "/api/recurrence-preview/",
                                {"recurrence": "every 4 weeks on tuesday 14:00", "start": at(14, 10).isoformat()})
        self.assertEqual([moment(value) for value in response.data["occurrences"]][:2], [at(20, 14), at(48, 14)])
        response = self.request("post", "/api/recurrence-preview/", {"recurrence": "every sometimes"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("“sometimes”", response.data["detail"])
        # The bucket form's preview says it in words too.
        response = self.request("post", "/api/recurrence-preview/", {"start_times": "weekdays at 9"})
        self.assertEqual(response.data["description"], "every weekday at 09:00")


class OccurrencesTest(RecurringApiTestCase):
    def setUp(self):
        super().setUp()
        self.chore = self.create(header="Water plants", duration="00:15:00", recurrence="every tuesday 20:00")

    def test_the_next_one_appears_when_its_date_is_reached(self):
        self.at_time(at(13, 19))
        [first] = self.tasks("Water plants")
        self.at_time(at(13, 20, 30))
        # Not done in time: the new one takes its place, they do not pile up.
        [second] = self.tasks("Water plants")
        self.assertEqual((moment(second["occurrence"]), second["is_done"], second["occurrence_count"]),
                         (at(13, 20), False, 1))
        self.assertNotEqual(second["id"], first["id"])
        # Weeks later: one task, for the latest date.
        self.at_time(at(34, 21))
        self.assertEqual([moment(task["occurrence"]) for task in self.tasks("Water plants")], [at(34, 20)])

    def test_completing_one_completes_only_that_one(self):
        self.request("post", f"/api/tasks/{self.chore['id']}/track/start/")
        self.at_time(MONDAY + timedelta(minutes=5))
        self.request("post", f"/api/tasks/{self.chore['id']}/track/stop/")
        self.at_time(at(13, 20, 30))
        first, second = self.tasks("Water plants")  # worked on: the first stays
        response = self.request("post", f"/api/tasks/{first['id']}/complete/")
        self.assertEqual(response.status_code, 200, response.data)
        self.request("post", f"/api/tasks/{second['id']}/track/start/")
        self.at_time(at(13, 20, 40))
        self.request("post", f"/api/tasks/{second['id']}/track/stop/")
        first, second = self.tasks("Water plants")
        self.assertEqual((first["is_done"], second["is_done"]), (True, False))
        self.assertEqual((first["time_spent"], second["time_spent"]), ("00:05:00", "00:10:00"))

    def test_changing_the_rule(self):
        response = self.request("patch", f"/api/tasks/{self.chore['id']}/", {"recurrence": "every thursday 18:00"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((moment(response.data["occurrence"]), response.data["recurrence_description"]),
                         (at(8, 18), "every Thursday at 18:00"))
        response = self.request("patch", f"/api/tasks/{self.chore['id']}/", {"recurrence": "every sometimes"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(TaskSeries.objects.get().recurrence, "every thursday 18:00")

    def test_stopping_the_repetition(self):
        response = self.request("patch", f"/api/tasks/{self.chore['id']}/", {"recurrence": ""})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["series_id"])
        self.assertFalse(TaskSeries.objects.exists())
        self.at_time(at(20, 21))
        self.assertEqual(len(self.tasks("Water plants")), 1)

    def test_deleting_one_or_all(self):
        self.request("post", f"/api/tasks/{self.chore['id']}/complete/")
        self.at_time(at(13, 21))
        first, second = self.tasks("Water plants")
        self.assertEqual(self.request("delete", f"/api/tasks/{second['id']}/").status_code, 204)
        self.assertEqual(len(self.tasks("Water plants")), 1)  # the 13th does not come back
        self.at_time(at(20, 21))
        self.assertEqual(len(self.tasks("Water plants")), 2)
        response = self.request("delete", f"/api/tasks/{first['id']}/?occurrences=all")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.tasks("Water plants"), [])
        self.assertFalse(TaskSeries.objects.exists())

    def test_deleting_the_only_one_hands_over_to_the_next(self):
        self.assertEqual(self.request("delete", f"/api/tasks/{self.chore['id']}/").status_code, 204)
        [following] = self.tasks("Water plants")
        self.assertEqual(moment(following["occurrence"]), at(13, 20))


class FollowingOccurrencesTest(RecurringApiTestCase):
    def test_changes_to_this_and_the_following(self):
        self.create(header="Jour fixe", is_appointment=True, duration="01:00:00",
                    start_date=at(6, 20).isoformat(), recurrence="every tuesday 20:00")
        first, second, third, fourth = self.tasks("Jour fixe")[:4]
        response = self.request("patch", f"/api/tasks/{second['id']}/", {"description": "Only this one"})
        self.assertEqual(response.status_code, 200)
        response = self.request("patch", f"/api/tasks/{third['id']}/",
                                {"header": "Team meeting", "duration": "00:45:00", "scope": "following"})
        self.assertEqual(response.status_code, 200, response.data)
        tasks = sorted(Task.objects.filter(series_id=first["series_id"]), key=lambda task: task.occurrence)
        self.assertEqual([(task.header, task.duration.seconds // 60, task.description) for task in tasks][:4],
                         [("Jour fixe", 60, ""), ("Jour fixe", 60, "Only this one"),
                          ("Team meeting", 45, ""), ("Team meeting", 45, "")])
        self.assertEqual({task.header for task in tasks[2:]}, {"Team meeting"})
        self.at_time(at(13, 9))
        self.assertEqual(self.tasks()[-1]["header"], "Team meeting")  # the next one copies the latest


class PlanTest(RecurringApiTestCase):
    def setUp(self):
        super().setUp()
        TimeBucketType.objects.create(name="Evenings", start_times="every day at 19:00",
                                      duration=timedelta(hours=3), anchor=MONDAY)

    def plan_items(self, header):
        response = self.request("get", "/api/plan/")
        self.assertEqual(response.status_code, 200)
        items = response.data["appointments"] + [item for bucket in response.data["buckets"]
                                                 for item in bucket["items"]]
        return sorted((item["start_time"].astimezone(BERLIN), item["is_appointment"])
                      for item in items if item["header"] == header)

    def test_appointments_block_their_time_ahead(self):
        self.create(header="Choir", is_appointment=True, duration="02:00:00", start_date=at(6, 19).isoformat(),
                    recurrence="every tuesday at 19:00")
        items = self.plan_items("Choir")
        self.assertEqual(items[:3], [(at(6, 19), True), (at(13, 19), True), (at(20, 19), True)])

    def test_a_task_is_planned_from_its_date_on(self):
        self.create(header="Water plants", duration="00:15:00", recurrence="every wednesday 20:00")
        self.assertEqual(self.plan_items("Water plants"), [(at(7, 20), False)])  # not on Monday or Tuesday


class IsolationTest(RecurringApiTestCase):
    def test_another_users_series_stays_theirs(self):
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIClient as Client
        self.create(header="Water plants", recurrence="every day at 8:00")
        bob = Client()
        bob.force_login(get_user_model().objects.create_user("bob"))
        self.now = at(9, 9)
        with mock.patch("django.utils.timezone.now", side_effect=lambda: self.now):
            self.assertEqual(bob.get("/api/tasks/").data, [])
        self.assertEqual([moment(task["occurrence"]) for task in self.tasks("Water plants")], [at(9, 8)])
        self.assertEqual(Task.all_objects.filter(owner__username="bob").count(), 0)
