"""The time sheet (README: Time sheet): begin and end of work per day from
the sessions on #Arbeit/#Work tasks, pauses from #Freizeit/#Freetime ones
between them, and the tasks counted."""
from datetime import date, datetime
from unittest import mock
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.utils import timezone

from plina.scoping import owner_scope
from tasks.models import Tag, Task, TrackingSession
from tasks.services.settings import get_settings
from tasks.services.timesheet import kind_of, time_sheet
from tasks.tests.support import APIClient, TestCase

BERLIN = ZoneInfo("Europe/Berlin")


def at(day, hour, minute=0):
    """A moment in October 2026, Berlin time."""
    return datetime(2026, 10, day, hour, minute, tzinfo=BERLIN)


class TimeSheetCase(TestCase):
    def setUp(self):
        self.zone = timezone.override(BERLIN)
        self.zone.__enter__()
        self.addCleanup(self.zone.__exit__, None, None, None)
        settings = get_settings()
        settings.time_zone = "Europe/Berlin"
        settings.save()
        self.arbeit = Tag.objects.create(name="Arbeit")
        self.work = Tag.objects.create(name="work")  # any case
        self.freizeit = Tag.objects.create(name="Freizeit")
        self.maker = Tag.objects.create(name="maker")

    def task(self, header, *tags):
        task = Task.objects.create(header=header)
        task.tags.set(tags)
        return task

    def track(self, task, start, end=None):
        return TrackingSession.objects.create(task=task, start=start, end=end)

    def sheet(self, first=1, last=31, now=None):
        return time_sheet(date(2026, 10, first), date(2026, 10, last), now=now or at(31, 23))


class KindTest(TimeSheetCase):
    def test_work_wins_over_free_time(self):
        self.assertEqual(kind_of(["Arbeit"]), "work")
        self.assertEqual(kind_of(["#WORK", "maker"]), "work")
        self.assertEqual(kind_of(["freetime"]), "pause")
        self.assertEqual(kind_of(["Freizeit", "Work"]), "work")
        self.assertIsNone(kind_of(["maker"]))
        self.assertIsNone(kind_of([]))


class TimeSheetTest(TimeSheetCase):
    def test_begin_end_and_pauses_of_a_day(self):
        report = self.task("Report", self.arbeit, self.maker)
        review = self.task("Review", self.work)
        lunch = self.task("Lunch", self.freizeit)
        hobby = self.task("Soldering", self.maker)  # neither: not on the sheet
        self.track(lunch, at(7, 7, 30), at(7, 8, 0))  # before work: no pause
        self.track(report, at(7, 8, 15), at(7, 12, 0))
        self.track(lunch, at(7, 12, 0), at(7, 12, 45))
        self.track(hobby, at(7, 12, 45), at(7, 13, 0))
        self.track(review, at(7, 13, 0), at(7, 15, 30))
        self.track(report, at(7, 15, 30), at(7, 17, 0))
        self.track(lunch, at(7, 16, 50), at(7, 18, 0))  # overlaps the end: 10 minutes
        self.track(lunch, at(7, 20, 0), at(7, 22, 0))  # after work: no pause

        [day] = self.sheet()

        self.assertEqual((day.date, day.begin, day.end), (date(2026, 10, 7), at(7, 8, 15), at(7, 17, 0)))
        self.assertEqual(day.pause_seconds, 55 * 60)
        self.assertEqual(day.working_seconds, (8 * 60 + 45 - 55) * 60)
        self.assertFalse(day.running)
        self.assertEqual([(entry.header, entry.kind, entry.seconds) for entry in day.entries], [
            ("Report", "work", (225 + 90) * 60), ("Lunch", "pause", 55 * 60), ("Review", "work", 150 * 60),
        ])
        self.assertEqual([tag["name"] for tag in day.entries[0].tags], ["Arbeit", "maker"])

    def test_days_without_work_are_left_out(self):
        self.track(self.task("Hike", self.freizeit), at(10, 9), at(10, 15))
        self.track(self.task("Report", self.arbeit), at(12, 9), at(12, 10))
        self.assertEqual([day.date.day for day in self.sheet()], [12])

    def test_a_session_over_midnight_counts_on_the_day_it_began(self):
        release = self.task("Release", self.work)
        self.track(release, at(8, 14), at(8, 18))
        self.track(release, at(8, 22), at(9, 1, 30))
        self.track(release, at(9, 9), at(9, 12))
        first, second = self.sheet()
        self.assertEqual((first.begin, first.end, first.working_seconds), (at(8, 14), at(9, 1, 30), 690 * 60))
        self.assertEqual(first.entries[0].seconds, (240 + 210) * 60)
        self.assertEqual((second.begin, second.end), (at(9, 9), at(9, 12)))

    def test_days_are_the_users_days(self):
        # 23:30 UTC on the 8th is 01:30 on the 9th in Berlin.
        utc = ZoneInfo("UTC")
        self.track(self.task("Night shift", self.work), datetime(2026, 10, 8, 23, 30, tzinfo=utc),
                   datetime(2026, 10, 9, 0, 30, tzinfo=utc))
        [day] = self.sheet()
        self.assertEqual(day.date, date(2026, 10, 9))

    def test_a_running_session_counts_until_now(self):
        report = self.task("Report", self.arbeit)
        self.track(report, at(7, 9), at(7, 11))
        self.track(report, at(7, 14))
        [day] = self.sheet(now=at(7, 15, 20))
        self.assertTrue(day.running)
        self.assertEqual(day.end, at(7, 15, 20))
        self.assertEqual(day.entries[0].seconds, (120 + 80) * 60)
        self.assertTrue(day.entries[0].running)

    def test_only_the_days_asked_for(self):
        report = self.task("Report", self.arbeit)
        self.track(report, at(5, 9), at(5, 10))
        self.track(report, at(6, 9), at(6, 10))
        self.track(report, at(7, 23), at(8, 1))
        self.assertEqual([(day.date.day, day.working_seconds) for day in self.sheet(6, 7)],
                         [(6, 3600), (7, 2 * 3600)])


class TimeSheetApiTest(TimeSheetCase):
    def setUp(self):
        super().setUp()
        self.api = APIClient()

    def test_this_month_by_default(self):
        report = self.task("Report", self.arbeit)
        self.track(report, at(7, 9), at(7, 12))
        self.track(report, at(31, 9), at(31, 10))
        self.track(report, datetime(2026, 11, 2, 9, tzinfo=BERLIN), datetime(2026, 11, 2, 10, tzinfo=BERLIN))
        with mock.patch("django.utils.timezone.now", return_value=at(15, 12)):
            response = self.api.get("/api/timesheet/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual((data["from"], data["to"]), ("2026-10-01", "2026-10-31"))
        self.assertEqual(data["work_tags"], ["Arbeit", "Work"])
        self.assertEqual(data["pause_tags"], ["Freizeit", "Freetime"])
        first = data["days"][0]
        self.assertEqual(first["date"], "2026-10-07")
        self.assertEqual(datetime.fromisoformat(first["begin"]), at(7, 9))
        self.assertEqual((first["working_seconds"], first["pause_seconds"], first["running"]), (3 * 3600, 0, False))
        self.assertEqual(first["entries"], [{
            "task_id": str(report.id), "header": "Report", "kind": "work", "seconds": 3 * 3600, "running": False,
            "tags": [{"id": str(self.arbeit.id), "name": "Arbeit", "hex_color": self.arbeit.hex_color}],
        }])
        self.assertEqual([day["date"] for day in data["days"]], ["2026-10-07", "2026-10-31"])

    def test_a_range(self):
        self.track(self.task("Report", self.arbeit), at(7, 9), at(7, 12))
        data = self.api.get("/api/timesheet/", {"from": "2026-10-07", "to": "2026-10-07"}).json()
        self.assertEqual(len(data["days"]), 1)

    def test_refuses_what_it_cannot_read(self):
        self.assertContains(self.api.get("/api/timesheet/", {"from": "7.10.2026"}), "2026-10-01", status_code=400)
        self.assertContains(self.api.get("/api/timesheet/", {"from": "2026-10-07", "to": "2026-10-01"}),
                            "before the first", status_code=400)
        self.assertContains(self.api.get("/api/timesheet/", {"from": "2026-01-01", "to": "2027-06-01"}),
                            "At most", status_code=400)

    def test_only_your_own_time(self):
        other = get_user_model().objects.create_user("other")
        with owner_scope(other):
            tag = Tag.objects.create(name="Work")
            task = Task.objects.create(header="Their task")
            task.tags.set([tag])
            TrackingSession.objects.create(task=task, start=at(7, 9), end=at(7, 10))
        self.track(self.task("Report", self.arbeit), at(8, 9), at(8, 10))
        data = self.api.get("/api/timesheet/", {"from": "2026-10-01", "to": "2026-10-31"}).json()
        self.assertEqual([day["date"] for day in data["days"]], ["2026-10-08"])

    def test_needs_a_login(self):
        anonymous = APIClient()
        anonymous.logout()
        self.assertIn(anonymous.get("/api/timesheet/").status_code, (401, 403))
