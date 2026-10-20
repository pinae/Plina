"""Unplanned tasks (README: Unplanned appointments): an event you may join —
Claire's PhD defense — shown in the Week view as a reminder, but neither
planned nor blocking time. Once you decide to go (the flag off), the next
re-plan plans around it like any appointment."""
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock

from tasks.models import Task, TimeBucket, TimeBucketType
from tasks.tests.support import APIClient, TestCase

UTC = dt_timezone.utc
NOW = datetime(2026, 10, 12, 8, 0, tzinfo=UTC)  # Monday, before the bucket (9–13)


def at(hour):
    return NOW.replace(hour=hour)


class UnplannedTest(TestCase):
    def setUp(self):
        self.clock = mock.patch("django.utils.timezone.now", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.api = APIClient()
        work = TimeBucketType.objects.create(name="Work", duration=timedelta(hours=4))
        TimeBucket.objects.create(start_date=at(9), duration=timedelta(hours=4), type=work)
        self.write = Task.objects.create(header="Write chapter", duration=timedelta(hours=2))
        created = self.api.post("/api/tasks/", {
            "header": "Claire's PhD defense", "is_appointment": True, "is_unplanned": True,
            "start_date": at(9).isoformat(), "duration": "02:00:00",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(created.data["is_unplanned"])
        self.defense = Task.objects.get(id=created.data["id"])

    def planned(self, data):
        items = data["appointments"] + [item for bucket in data["buckets"] for item in bucket["items"]]
        return {item["header"]: datetime.fromisoformat(item["start_time"].replace("Z", "+00:00")) for item in items}

    def test_is_neither_planned_nor_blocking(self):
        alternatives = self.api.post("/api/plan/alternatives/").json()["alternatives"]
        for alternative in alternatives:
            planned = self.planned(alternative)
            self.assertNotIn("Claire's PhD defense", planned)
            self.assertEqual(planned["Write chapter"], at(9))  # the time stays free for work
        self.assertNotIn("Claire's PhD defense", self.planned(self.api.get("/api/plan/").json()))

    def test_once_joined_the_next_replan_plans_around_it(self):
        accepted = self.api.post("/api/plan/alternatives/").json()["alternatives"][0]
        self.api.post(f"/api/plans/{accepted['id']}/accept/")

        response = self.api.patch(f"/api/tasks/{self.defense.id}/", {"is_unplanned": False}, format="json")
        self.assertEqual(response.status_code, 200)
        planned = self.planned(self.api.post("/api/plan/recalculate/").json())

        self.assertEqual(planned["Claire's PhD defense"], at(9))
        self.assertEqual(planned["Write chapter"], at(11))

    def test_unplanning_takes_it_out_of_the_plan_again(self):
        self.defense.is_unplanned = False
        self.defense.save()
        accepted = self.api.post("/api/plan/alternatives/").json()["alternatives"][0]
        self.api.post(f"/api/plans/{accepted['id']}/accept/")

        self.api.patch(f"/api/tasks/{self.defense.id}/", {"is_unplanned": True}, format="json")
        planned = self.planned(self.api.post("/api/plan/recalculate/").json())

        self.assertNotIn("Claire's PhD defense", planned)
        self.assertEqual(planned["Write chapter"], at(9))


class WaitingForAMaybeTest(TestCase):
    """A project waits for a colleague who is away until November 2nd: a
    maybe appointment on that day, and every task of the project depends on
    it. Nothing of the project is planned before the appointment ends;
    other work still fills this week."""

    def setUp(self):
        self.clock = mock.patch("django.utils.timezone.now", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.api = APIClient()
        work = TimeBucketType.objects.create(name="Work", duration=timedelta(hours=4))
        for day in range(28):  # four weeks of weekday mornings, 9–13
            start = at(9) + timedelta(days=day)
            if start.weekday() < 5:
                TimeBucket.objects.create(start_date=start, duration=timedelta(hours=4), type=work)
        self.project = Task.objects.create(header="Joint project")
        self.joint = [Task.objects.create(header=f"Joint {index}", parent=self.project, order=index,
                                          duration=timedelta(hours=2)) for index in range(3)]
        Task.objects.create(header="Solo work", duration=timedelta(hours=2))
        self.back = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
        created = self.api.post("/api/tasks/", {
            "header": "Colleague back", "is_appointment": True, "is_unplanned": True,
            "start_date": self.back.isoformat(), "duration": "00:30:00",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.marker = created.data["id"]

    def depend_on_the_marker(self, *tasks):
        for task in tasks:
            response = self.api.post("/api/dependencies/", {"predecessor": self.marker, "successor": str(task.id)},
                                     format="json")
            self.assertEqual(response.status_code, 201, response.content)

    def starts(self, data):
        items = data["appointments"] + [item for bucket in data["buckets"] for item in bucket["items"]]
        starts = {}
        for item in items:
            start = datetime.fromisoformat(item["start_time"].replace("Z", "+00:00"))
            starts[item["header"]] = min(start, starts.get(item["header"], start))
        return starts

    def assert_waits(self, data, label=""):
        starts = self.starts(data)
        ready = self.back + timedelta(minutes=30)
        for task in self.joint:
            self.assertIn(task.header, starts, label)
            self.assertGreaterEqual(starts[task.header], ready, f"{label}: {task.header} before the colleague is back")
        self.assertLess(starts["Solo work"], at(9) + timedelta(days=5), label)  # other work goes on this week
        self.assertNotIn("Colleague back", starts, label)  # still only a reminder

    def test_every_task_of_the_project_depends_on_the_maybe(self):
        self.depend_on_the_marker(*self.joint)

        for alternative in self.api.post("/api/plan/alternatives/").json()["alternatives"]:
            self.assert_waits(alternative, alternative["label"])
        accepted = self.api.post("/api/plan/alternatives/").json()["alternatives"][0]
        self.api.post(f"/api/plans/{accepted['id']}/accept/")
        self.assert_waits(self.api.post("/api/plan/recalculate/").json(), "re-plan")

    def test_the_project_depends_on_the_maybe(self):
        self.depend_on_the_marker(self.project)  # a parent's predecessors hold for all its tasks

        for alternative in self.api.post("/api/plan/alternatives/").json()["alternatives"]:
            self.assert_waits(alternative, alternative["label"])
