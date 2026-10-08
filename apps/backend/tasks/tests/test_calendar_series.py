"""Repeating calendar events as recurring tasks (README: Calendar): their
occurrences join one series by themselves, as long as they fit its rule."""
from datetime import timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.utils import timezone

from tasks.models import CalendarLink, Tag, Task, TaskSeries
from tasks.services import calendar_sync
from tasks.services.calendar_series import DISMISSED, mismatch, rule_text
from tasks.services.merge import merge_into
from tasks.services.recurrence import first_occurrences, parse_rule
from tasks.services.series import keep_up, make_recurring
from tasks.tests.support import APIClient
from tasks.tests.test_calendar import (MONDAY, TEAM_CALL, TEAM_CALL_MOVED, CalendarTestCase, at, event,
                                       feed)


def team_calls():
    return list(Task.objects.filter(header__startswith="Team call").order_by("occurrence", "start_date"))


class RuleTextTest(CalendarTestCase):
    """The calendar's repeat rule in Plina's words — that Plina reads back."""

    CASES = [
        ({"FREQ": ["WEEKLY"], "BYDAY": ["TU"]}, at(6, 10), "every tuesday at 10:00"),
        ({"FREQ": ["WEEKLY"]}, at(6, 10), "every tuesday at 10:00"),
        ({"FREQ": ["WEEKLY"], "BYDAY": ["FR", "MO", "WE"]}, at(5, 9, 30),
         "every monday, wednesday and friday at 09:30"),
        ({"FREQ": ["WEEKLY"], "INTERVAL": [2], "BYDAY": ["TU"]}, at(6, 10), "every 2 weeks on tuesday at 10:00"),
        ({"FREQ": ["WEEKLY"], "BYDAY": ["MO", "TU", "WE", "TH", "FR"]}, at(5, 9, 15), "every weekday at 09:15"),
        ({"FREQ": ["DAILY"]}, at(5, 8), "every day at 08:00"),
        ({"FREQ": ["DAILY"], "INTERVAL": [3]}, at(5, 8), "every 3 days at 08:00"),
        ({"FREQ": ["MONTHLY"], "BYDAY": ["1MO"]}, at(5, 10), "every first monday of the month at 10:00"),
        ({"FREQ": ["MONTHLY"], "BYDAY": ["-1FR"]}, at(30, 16), "every last friday of the month at 16:00"),
        ({"FREQ": ["MONTHLY"], "INTERVAL": [2], "BYDAY": ["1MO"]}, at(5, 10),
         "every 2 months on the first monday at 10:00"),
        ({"FREQ": ["MONTHLY"], "BYMONTHDAY": [15]}, at(15, 10), "every 15th of the month at 10:00"),
        ({"FREQ": ["MONTHLY"]}, at(22, 11), "every 22nd of the month at 11:00"),
        ({"FREQ": ["YEARLY"]}, at(24, 18), "every 24th of october at 18:00"),
        ({"FREQ": ["WEEKLY"], "BYDAY": ["TU"], "UNTIL": ["20261231T000000Z"]}, at(6, 10), "every tuesday at 10:00"),
    ]

    def test_said_and_read_back(self):
        for rrule, start, text in self.CASES:
            with self.subTest(text=text):
                self.assertEqual(rule_text(rrule, start), text)
                rule = parse_rule(text)  # Plina understands what it says
                self.assertEqual(first_occurrences(rule, start - timedelta(minutes=1), 1)[0], start)

    def test_what_plina_does_not_say(self):
        self.assertIsNone(rule_text({"FREQ": ["MONTHLY"], "BYDAY": ["MO"], "BYSETPOS": [2]}, at(12, 10)))
        self.assertIsNone(rule_text({"FREQ": ["HOURLY"]}, at(5, 10)))
        self.assertIsNone(rule_text({"FREQ": ["MONTHLY"], "BYDAY": ["5MO"]}, at(5, 10)))


class GroupingTest(CalendarTestCase):
    def test_the_occurrences_of_a_repeating_event_are_one_recurring_task(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)

        calls = team_calls()
        self.assertEqual(len(calls), 8)  # the 20th is excepted
        series = TaskSeries.objects.get()
        self.assertEqual({call.series_id for call in calls}, {series.id})
        self.assertEqual((series.recurrence, series.calendar_auto, series.calendar_uid),
                         ("every tuesday at 10:00", True, "team@google.com"))
        # Moved on its own: by its original date in the series, at the new time.
        moved = next(call for call in calls if call.header == "Team call (moved)")
        self.assertEqual((moved.occurrence, moved.start_date), (at(13, 10), at(14, 15)))
        self.assertEqual(calls[0].place, "Room 4")

    def test_in_the_users_time_zone_whatever_zone_is_active(self):
        # Read outside a request (UTC active): the rule is still Berlin's 10:00,
        # also after the clocks change on October 25th.
        with timezone.override(ZoneInfo("UTC")):
            self.read(TEAM_CALL, TEAM_CALL_MOVED)
        series = TaskSeries.objects.get()
        self.assertEqual(series.recurrence, "every tuesday at 10:00")
        self.assertFalse(Task.objects.filter(header__startswith="Team call", series=None).exists())

    def test_new_occurrences_join_by_themselves(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        later = MONDAY + timedelta(days=28)
        self.read(TEAM_CALL, TEAM_CALL_MOVED, now=later)

        series = TaskSeries.objects.get()
        calls = team_calls()
        self.assertEqual({call.series_id for call in calls}, {series.id})
        self.assertGreater(max(call.occurrence for call in calls), MONDAY + timedelta(days=60))
        self.assertTrue(series.calendar_auto)

    def test_new_occurrences_take_your_tags_priority_and_project(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        tag = Tag.objects.create(name="Arbeit")
        project = Task.objects.create(header="Company")
        latest = team_calls()[-1]
        latest.priority, latest.parent = 9, project
        latest.save()
        latest.tags.set([tag])

        self.read(TEAM_CALL, TEAM_CALL_MOVED, now=MONDAY + timedelta(days=28))

        newest = team_calls()[-1]
        self.assertGreater(newest.occurrence, latest.occurrence)
        self.assertEqual((newest.priority, newest.parent_id, list(newest.tags.all())), (9, project.id, [tag]))

    def test_the_series_makes_no_occurrences_itself(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        count = len(team_calls())
        with mock.patch("django.utils.timezone.now", return_value=MONDAY):
            keep_up()
        self.assertEqual(len(team_calls()), count)
        self.assertFalse(Task.objects.filter(occurrence=at(20, 10)).exists())  # excepted in the calendar

    def test_an_occurrence_that_does_not_fit_switches_to_asking(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        # The calendar moves the meeting to Wednesdays (same event, new rule).
        wednesdays = event("team@google.com", "Team call", at(28, 10), at(28, 11), RRULE="FREQ=WEEKLY;BYDAY=WE")
        self.read(wednesdays)

        series = TaskSeries.objects.get()
        self.assertFalse(series.calendar_auto)
        self.assertIn("“every tuesday at 10:00” does not have", series.calendar_mismatch)
        self.assertIn("Wed 28/10 10:00", series.calendar_mismatch)
        # Nothing is lost: they came as tasks of their own, which show the
        # series' rule and why it asks.
        loose = Task.objects.filter(header="Team call", series=None).order_by("start_date")
        self.assertTrue(loose.exists())
        shown = APIClient().get(f"/api/tasks/{loose.first().id}/").json()
        self.assertEqual((shown["recurrence"], shown["series_id"]), ("every tuesday at 10:00", None))
        self.assertFalse(shown["series_calendar"]["auto"])
        self.assertIn("does not have", shown["series_calendar"]["mismatch"])

        # Changing the rule to fit and switching it on again there: they join.
        response = APIClient().patch(f"/api/tasks/{loose.first().id}/", {
            "recurrence": "every wednesday at 10:00", "calendar_auto": True}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        series.refresh_from_db()
        self.assertEqual((series.recurrence, series.calendar_auto, series.calendar_mismatch),
                         ("every wednesday at 10:00", True, ""))
        self.assertFalse(Task.objects.filter(header="Team call", series=None).exists())
        self.assertEqual(TaskSeries.objects.count(), 1)
        self.assertEqual(response.json()["series_calendar"], {"name": "Google", "auto": True, "mismatch": ""})

        # And the next ones join by themselves.
        self.read(wednesdays, now=MONDAY + timedelta(days=28))
        self.assertFalse(Task.objects.filter(header="Team call", series=None).exists())

    def test_switching_on_with_a_rule_that_still_does_not_fit(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        self.read(event("team@google.com", "Team call", at(28, 10), at(28, 11), RRULE="FREQ=WEEKLY;BYDAY=WE"))
        loose = Task.objects.filter(header="Team call", series=None).first()

        response = APIClient().patch(f"/api/tasks/{loose.id}/", {"calendar_auto": True}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["series_calendar"]["auto"])
        self.assertIn("does not have", response.json()["series_calendar"]["mismatch"])

    def test_one_as_long_as_the_others(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        series = TaskSeries.objects.get()
        reason = mismatch(series, at(27, 10), at(27, 10), at(27, 11, 30), "Team call")
        self.assertIn("takes 1h 30m, the other occurrences 1h", reason)
        self.assertIsNone(mismatch(series, at(27, 10), at(27, 10), at(27, 11), "Team call"))
        # Moved on its own, it may take longer.
        self.assertIsNone(mismatch(series, at(27, 10), at(28, 14), at(28, 16), "Team call"))

    def test_while_asking_new_occurrences_come_as_tasks_of_their_own(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        member = Task.objects.filter(series__isnull=False).first()
        APIClient().patch(f"/api/tasks/{member.id}/", {"calendar_auto": False}, format="json")

        self.read(TEAM_CALL, TEAM_CALL_MOVED, now=MONDAY + timedelta(days=28))

        self.assertTrue(Task.objects.filter(header="Team call", series=None).exists())

    def test_a_rule_plina_cannot_say_leaves_them_as_they_are(self):
        odd = event("odd@google.com", "Odd", at(12, 10), at(12, 11), RRULE="FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2")
        self.read(odd)
        self.assertTrue(Task.objects.filter(header="Odd").exists())
        self.assertFalse(Task.objects.filter(header="Odd", series__isnull=False).exists())


class YourSeriesTest(CalendarTestCase):
    def test_merging_an_occurrence_into_a_recurring_task_of_yours_links_it(self):
        with mock.patch("django.utils.timezone.now", return_value=MONDAY):
            jour_fixe = Task.objects.create(header="Jour fixe", is_appointment=True, start_date=at(6, 10),
                                            duration=timedelta(hours=1))
            make_recurring(jour_fixe, "every tuesday at 10:00", now=MONDAY)
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        mine = Task.objects.get(header="Jour fixe", occurrence=at(27, 10))
        theirs = Task.objects.get(header="Team call", occurrence=at(27, 10))
        merge_into(mine, theirs)

        self.read(TEAM_CALL, TEAM_CALL_MOVED)

        series = jour_fixe.series
        series.refresh_from_db()
        self.assertEqual((series.calendar_uid, series.calendar_auto), ("team@google.com", True))
        self.assertEqual(TaskSeries.objects.count(), 1)  # the one made for the event is gone
        coming = Task.objects.filter(series=series, occurrence__gte=MONDAY)
        self.assertEqual(coming.count(), 8)  # one per date, no doubles
        self.assertTrue(all(task.calendar_links.exists() for task in coming))
        self.assertFalse(coming.filter(occurrence=at(20, 10)).exists())  # excepted in the calendar
        self.assertEqual(coming.get(occurrence=at(27, 10)).header, "Jour fixe")  # your words stay


class DismissAndRemoveTest(CalendarTestCase):
    def test_deleting_all_occurrences_dismisses_the_event(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        member = team_calls()[0]
        response = APIClient().delete(f"/api/tasks/{member.id}/?occurrences=all")
        self.assertEqual(response.status_code, 204)

        self.read(TEAM_CALL, TEAM_CALL_MOVED, now=MONDAY + timedelta(days=28))

        self.assertEqual(team_calls(), [])
        self.assertTrue(CalendarLink.objects.filter(uid="team@google.com", recurrence_id=DISMISSED).exists())

    def test_without_the_calendar_it_goes_on_as_a_recurring_task_of_yours(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        series = TaskSeries.objects.get()
        count = Task.objects.filter(series=series).count()
        with mock.patch("django.utils.timezone.now", return_value=MONDAY):
            calendar_sync.unsubscribe(self.calendar)
        series.refresh_from_db()
        self.assertIsNone(series.calendar_subscription)
        self.assertEqual(Task.objects.filter(series=series).count(), count)  # the coming ones stay

        later = MONDAY + timedelta(days=28)
        with mock.patch("django.utils.timezone.now", return_value=later):
            keep_up()
        self.assertGreater(Task.objects.filter(series=series).count(), count)  # its rule makes the next ones

    def test_emptying_the_rule_is_refused(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        member = team_calls()[-1]
        response = APIClient().patch(f"/api/tasks/{member.id}/", {"recurrence": ""}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("follows a repeating event of Google", response.json()["recurrence"][0])

    def test_the_tasks_tab_gets_the_link(self):
        self.read(TEAM_CALL, TEAM_CALL_MOVED)
        tasks = APIClient().get("/api/tasks/").json()
        call = next(task for task in tasks if task["header"] == "Team call")
        self.assertEqual(call["series_calendar"], {"name": "Google", "auto": True, "mismatch": ""})
        self.assertEqual(call["recurrence"], "every tuesday at 10:00")
