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
