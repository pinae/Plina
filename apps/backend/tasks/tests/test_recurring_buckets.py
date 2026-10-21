"""A recurring task in the time bucket made for it (README: Recurring
tasks): "Guten Morgen" every day, tagged #Freizeit, and a #Freizeit bucket
every morning — it is planned into each morning's bucket, not into the work
buckets of the day."""
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import override_settings

from tasks.models import Tag, Task, TimeBucketType
from tasks.services.settings import get_settings
from tasks.tests.support import APIClient, TestCase

BERLIN = ZoneInfo("Europe/Berlin")
#: Monday, before the first morning bucket.
MONDAY = datetime(2026, 10, 19, 6, 0, tzinfo=BERLIN)


def at(day, hour, minute=0):
    """Day 0 = that Monday."""
    return MONDAY.replace(hour=hour, minute=minute) + timedelta(days=day)


@override_settings(SESSION_COOKIE_AGE=365 * 24 * 3600)
class MorningCase(TestCase):
    """A #Freizeit bucket every weekday morning (7–8), an untagged work
    bucket from 9 to 13, and some work."""

    def setUp(self):
        settings = get_settings()
        settings.time_zone = "Europe/Berlin"
        settings.save()
        self.api = APIClient()
        self.now = MONDAY
        self.freizeit = Tag.objects.create(name="Freizeit")
        morning = TimeBucketType.objects.create(name="Morning", start_times="every weekday at 07:00",
                                                duration=timedelta(hours=1))
        morning.tags.add(self.freizeit)
        TimeBucketType.objects.create(name="Work", start_times="every weekday at 09:00", duration=timedelta(hours=4))
        Task.objects.create(header="Write report", duration=timedelta(hours=6), priority=5)

    def request(self, method, path, body=None):
        with mock.patch("django.utils.timezone.now", side_effect=lambda: self.now):
            return getattr(self.api, method)(path, body, format="json")

    def create_routine(self, rule="every day"):
        response = self.request("post", "/api/tasks/", {
            "header": "Guten Morgen", "duration": "00:30:00", "priority": 10, "recurrence": rule,
            "tag_ids": [str(self.freizeit.id)],
        })
        self.assertEqual(response.status_code, 201, response.data)

    def routine_starts(self, plan):
        """This week's (the plan goes on for weeks)."""
        items = [item for bucket in plan["buckets"] for item in bucket["items"]] + plan["appointments"]
        starts = sorted(datetime.fromisoformat(item["start_time"].replace("Z", "+00:00")).astimezone(BERLIN)
                        for item in items if item["header"] == "Guten Morgen")
        return [start for start in starts if start < at(7, 0)]


class MorningRoutineTest(MorningCase):
    def test_planned_into_each_morning_bucket_of_the_week(self):
        self.create_routine()
        mornings = [at(day, 7) for day in range(5)]  # Mon–Fri

        for alternative in self.request("post", "/api/plan/alternatives/").json()["alternatives"]:
            self.assertEqual(self.routine_starts(alternative), mornings, alternative["label"])


    def test_a_morning_that_is_over_is_not_made_up_elsewhere(self):
        self.now = at(0, 10)  # Monday's morning bucket is over
        self.create_routine()

        for alternative in self.request("post", "/api/plan/alternatives/").json()["alternatives"]:
            # Not into Monday's work bucket, and not twice on Tuesday morning.
            self.assertEqual(self.routine_starts(alternative), [at(day, 7) for day in range(1, 5)],
                             alternative["label"])
            # A morning (or weekend day) without its bucket passes quietly.
            self.assertEqual([warning for warning in alternative["warnings"] if warning["header"] == "Guten Morgen"],
                             [], alternative["label"])


class OwnBucketsTest(MorningCase):
    """A tagged task goes into the buckets that carry one of its tags, if
    there are such buckets; untagged ones are for the rest."""

    def plan_of(self, header):
        alternatives = self.request("post", "/api/plan/alternatives/").json()["alternatives"]
        starts = []
        for alternative in alternatives:
            items = [item for bucket in alternative["buckets"] for item in bucket["items"]]
            starts.append(sorted(datetime.fromisoformat(item["start_time"].replace("Z", "+00:00")).astimezone(BERLIN)
                                 for item in items if item["header"] == header))
        return starts

    def test_a_free_time_task_stays_out_of_the_work_bucket(self):
        self.now = at(0, 8, 30)  # today's morning is over
        reading = Task.objects.create(header="Read the paper", duration=timedelta(minutes=45), priority=9)
        reading.tags.add(self.freizeit)
        for [start] in self.plan_of("Read the paper"):
            self.assertEqual(start.hour, 7, start)  # a morning bucket, not today's work bucket at 9:00

    def test_a_task_whose_tag_no_bucket_carries_goes_anywhere(self):
        errand = Task.objects.create(header="Call the bank", duration=timedelta(minutes=30), priority=9)
        errand.tags.add(Tag.objects.create(name="errands"))
        for [start] in self.plan_of("Call the bank"):
            self.assertTrue(9 <= start.hour < 13, start)  # in an untagged work bucket



class OverlappingBucketTest(MorningCase):
    """Sleep in its own bucket (23:00 to 7:00, #Schlaf) while the evening's
    bucket runs on to 23:18: the sleep bucket's own task gets its time, the
    evening's work stops when the sleep bucket starts."""

    def setUp(self):
        super().setUp()
        self.schlaf = Tag.objects.create(name="Schlaf")
        TimeBucketType.objects.create(name="Evening", start_times="every day at 19:00",
                                      duration=timedelta(hours=4, minutes=18))
        night = TimeBucketType.objects.create(name="Night", start_times="every day at 23:00", duration=timedelta(hours=8))
        night.tags.add(self.schlaf)
        Task.objects.create(header="Big project", duration=timedelta(hours=300), priority=5)
        response = self.request("post", "/api/tasks/", {
            "header": "Schlaf", "duration": "08:00:00", "priority": 10, "recurrence": "every day at 23:00",
            "tag_ids": [str(self.schlaf.id)],
        })
        self.assertEqual(response.status_code, 201, response.data)

    def items(self, alternative, header):
        found = []
        for bucket in alternative["buckets"]:
            for item in bucket["items"]:
                if item["header"] == header:
                    start = datetime.fromisoformat(item["start_time"].replace("Z", "+00:00")).astimezone(BERLIN)
                    found.append((start, start + timedelta(seconds=item["duration"])))
        return sorted(found)

    def test_the_whole_night_goes_to_sleep(self):
        for alternative in self.request("post", "/api/plan/alternatives/").json()["alternatives"]:
            nights = [(start, end) for start, end in self.items(alternative, "Schlaf") if start < at(7, 0)]
            self.assertEqual(nights, [(at(day, 23), at(day + 1, 7)) for day in range(7)], alternative["label"])
            evening = [(start, end) for start, end in self.items(alternative, "Big project")
                       if start.hour >= 19 and start < at(7, 0)]
            self.assertTrue(evening)
            self.assertTrue(all(end.hour == 23 and end.minute == 0 or end.hour < 23 for _, end in evening), evening)

    def test_without_a_task_of_its_own_the_overlap_is_not_lost(self):
        Task.objects.filter(header="Schlaf").delete()
        alternative = self.request("post", "/api/plan/alternatives/").json()["alternatives"][0]
        night = [(start, end) for start, end in self.items(alternative, "Big project") if at(0, 19) <= start < at(1, 7)]
        self.assertEqual(sum((end - start for start, end in night), timedelta(0)), timedelta(hours=12))
