"""Recurring tasks (README: Recurring tasks, services.series): every
occurrence is a task of its own — completed and tracked on its own. An
appointment's occurrences exist for the planning horizon ahead (they block
their time); any other task's next occurrence appears when its date is
reached and is planned like any other task from then on."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from tasks.models import Tag, Task, TaskSeries, TrackingSession
from tasks.services.recurrence import RecurrenceError
from tasks.services.series import (apply_to_following, delete_occurrence, delete_series, make_recurring,
                                   spawn_occurrences)
from tasks.tests.support import TestCase

BERLIN = ZoneInfo("Europe/Berlin")
MONDAY = datetime(2026, 10, 5, 9, 0, tzinfo=BERLIN)


def at(day, hour=0, minute=0):
    """A moment in October 2026 (or later, day > 31 counts on), Berlin time."""
    return datetime(2026, 10, 1, hour, minute, tzinfo=BERLIN) + timedelta(days=day - 1)


class RecurringTestCase(TestCase):
    def setUp(self):
        self.zone = timezone.override(BERLIN)
        self.zone.__enter__()

    def tearDown(self):
        self.zone.__exit__(None, None, None)

    def occurrences(self, series):
        return list(Task.objects.filter(series=series).order_by("occurrence"))


class RecurringTaskTest(RecurringTestCase):
    def setUp(self):
        super().setUp()
        self.tag = Tag.objects.create(name="home")
        self.chore = Task.objects.create(header="Water plants", duration=timedelta(minutes=15), priority=4)
        self.chore.tags.add(self.tag)
        make_recurring(self.chore, "every tuesday at 20:00", now=MONDAY)
        self.series = self.chore.series

    def test_the_task_becomes_the_first_occurrence(self):
        self.assertEqual(self.chore.occurrence, at(6, 20))
        self.assertEqual(self.series.recurrence, "every tuesday at 20:00")
        self.assertEqual(spawn_occurrences(now=MONDAY), [])  # nothing else before the next date

    def test_the_next_one_appears_when_its_date_is_reached(self):
        self.assertEqual(spawn_occurrences(now=at(13, 19, 59)), [])
        [second] = spawn_occurrences(now=at(13, 20, 0))
        self.assertEqual((second.header, second.duration, second.priority, second.occurrence),
                         ("Water plants", timedelta(minutes=15), 4, at(13, 20)))
        self.assertEqual(list(second.tags.all()), [self.tag])
        self.assertEqual(spawn_occurrences(now=at(13, 21)), [])  # only once
        # The first one is still open: each is a task of its own.
        self.assertFalse(Task.objects.get(id=self.chore.id).is_done)

    def test_completing_one_completes_only_that_one_and_each_has_its_own_time(self):
        spawn_occurrences(now=at(13, 20))
        first, second = self.occurrences(self.series)
        first.time_spent = timedelta(minutes=20)
        first.completed_at = at(13, 21)
        first.save()
        second.refresh_from_db()
        self.assertFalse(second.is_done)
        self.assertEqual(second.time_spent, timedelta(0))
        [third] = spawn_occurrences(now=at(20, 20))
        self.assertEqual(third.occurrence, at(20, 20))

    def test_missed_dates_each_get_their_occurrence(self):
        self.assertEqual([t.occurrence for t in spawn_occurrences(now=at(28, 12))], [at(13, 20), at(20, 20), at(27, 20)])

    def test_new_occurrences_copy_the_latest_one(self):
        self.chore.header = "Water all plants"
        self.chore.description = "Also the balcony"
        self.chore.save()
        [second] = spawn_occurrences(now=at(13, 20))
        self.assertEqual((second.header, second.description), ("Water all plants", "Also the balcony"))

    def test_a_deadline_moves_along(self):
        self.chore.latest_finish_date = at(8, 18)  # two days after the occurrence
        self.chore.save()
        [second] = spawn_occurrences(now=at(13, 20))
        self.assertEqual(second.latest_finish_date, at(15, 18))

    def test_a_rule_without_a_time_is_due_from_the_start_of_the_day(self):
        task = Task.objects.create(header="Bins out")
        make_recurring(task, "every tuesday", now=MONDAY)
        self.assertEqual(task.occurrence, at(6))
        # Created on the day itself, it is today's.
        task = Task.objects.create(header="Laundry")
        make_recurring(task, "every monday", now=MONDAY)
        self.assertEqual(task.occurrence, at(5))

    def test_deleting_one_keeps_the_series_and_it_does_not_come_back(self):
        [second] = spawn_occurrences(now=at(13, 20))
        delete_occurrence(second)
        self.assertEqual(spawn_occurrences(now=at(14)), [])
        self.assertEqual(self.occurrences(self.series), [self.chore])
        self.assertEqual([t.occurrence for t in spawn_occurrences(now=at(20, 20))], [at(20, 20)])

    def test_deleting_all_occurrences(self):
        spawn_occurrences(now=at(20, 20))
        first = Task.objects.get(id=self.chore.id)
        first.completed_at = at(7)
        first.save()
        delete_series(first)
        self.assertFalse(Task.objects.filter(header="Water plants").exists())
        self.assertFalse(TaskSeries.objects.exists())
        self.assertEqual(spawn_occurrences(now=at(30)), [])

    def test_changes_can_apply_to_the_following_open_occurrences(self):
        spawn_occurrences(now=at(20, 20))
        first, second, third = self.occurrences(self.series)
        first.completed_at = at(7)
        first.save()
        apply_to_following(second, {"header": "Water the plants", "duration": timedelta(minutes=10)})
        self.assertEqual([(t.header, t.duration) for t in self.occurrences(self.series)],
                         [("Water plants", timedelta(minutes=15)), ("Water plants", timedelta(minutes=15)),
                          ("Water the plants", timedelta(minutes=10))])

    def test_a_task_with_subtasks_cannot_repeat(self):
        parent = Task.objects.create(header="Party")
        Task.objects.create(header="Invite", parent=parent)
        with self.assertRaisesMessage(RecurrenceError, "subtasks"):
            make_recurring(parent, "every friday", now=MONDAY)

    def test_an_unknown_rule_is_refused(self):
        task = Task.objects.create(header="Something")
        with self.assertRaisesMessage(RecurrenceError, "“sometimes”"):
            make_recurring(task, "every sometimes", now=MONDAY)
        self.assertIsNone(Task.objects.get(id=task.id).series)


class RecurringAppointmentTest(RecurringTestCase):
    def setUp(self):
        super().setUp()
        self.meeting = Task.objects.create(header="Jour fixe", is_appointment=True, duration=timedelta(hours=1),
                                           start_date=at(6, 20))
        make_recurring(self.meeting, "every tuesday at 20:00", now=MONDAY)
        self.series = self.meeting.series

    def test_occurrences_exist_for_the_planning_horizon_ahead(self):
        # Made with the series, not left to the next request.
        created = self.occurrences(self.series)
        self.assertEqual([t.start_date for t in created][:4], [at(6, 20), at(13, 20), at(20, 20), at(27, 20)])
        self.assertTrue(all(t.is_appointment and t.duration == timedelta(hours=1) for t in created))
        # 60 days ahead: until 4 December.
        self.assertEqual(created[-1].start_date, at(62, 20))  # Tuesday, 1 December
        self.assertEqual(spawn_occurrences(now=MONDAY), [])
        self.assertEqual([t.start_date for t in spawn_occurrences(now=at(10))], [at(69, 20)])  # days on: 8 December

    def test_the_start_snaps_to_the_rule(self):
        call = Task.objects.create(header="Call", is_appointment=True, duration=timedelta(minutes=30),
                                   start_date=at(5, 11))  # Monday 11:00, but the rule says Wednesdays at 9:00
        make_recurring(call, "every wednesday at 9:00", now=MONDAY)
        self.assertEqual((call.start_date, call.occurrence), (at(7, 9), at(7, 9)))

    def test_every_4_weeks_keeps_its_rhythm(self):
        review = Task.objects.create(header="Review", is_appointment=True, duration=timedelta(hours=1),
                                     start_date=at(13, 14))
        make_recurring(review, "every 4 weeks on tuesday 14:00", now=MONDAY)
        starts = [t.start_date for t in self.occurrences(review.series)]
        self.assertEqual(starts, [at(13, 14), at(32 + 9, 14)])  # 13 October, 10 November
        later = [t.start_date for t in spawn_occurrences(now=at(32 + 30)) if t.header == "Review"]
        self.assertEqual(later[:2], [at(32 + 30 + 7, 14), at(32 + 30 + 35, 14)])  # 8 December, 5 January

    def test_past_occurrences_complete_themselves_after_they_end(self):
        spawn_occurrences(now=MONDAY)
        spawn_occurrences(now=at(13, 21, 30))
        first, second = self.occurrences(self.series)[:2]
        self.assertEqual((first.completed_at, second.completed_at), (at(6, 21), at(13, 21)))

    def test_one_being_tracked_stays_open(self):
        spawn_occurrences(now=MONDAY)
        TrackingSession.objects.create(task=self.meeting, start=at(6, 20))
        spawn_occurrences(now=at(6, 22))
        self.assertFalse(Task.objects.get(id=self.meeting.id).is_done)

    def test_moving_one_moves_only_that_one(self):
        spawn_occurrences(now=MONDAY)
        second = self.occurrences(self.series)[1]
        second.start_date = at(14, 18)  # Wednesday this time
        second.save()
        self.assertEqual(spawn_occurrences(now=MONDAY), [])
        self.assertEqual([t.start_date for t in self.occurrences(self.series)][:3], [at(6, 20), at(14, 18), at(20, 20)])

    def test_changing_the_rule_replaces_the_following_untouched_ones(self):
        spawn_occurrences(now=MONDAY)
        first, second, third = self.occurrences(self.series)[:3]
        third.time_spent = timedelta(minutes=5)  # touched: stays
        third.save()
        make_recurring(second, "every thursday at 18:00", now=MONDAY)
        starts = [t.start_date for t in self.occurrences(self.series)][:4]
        self.assertEqual(starts, [at(6, 20), at(15, 18), at(20, 20), at(22, 18)])
        self.assertEqual(spawn_occurrences(now=MONDAY), [])

    def test_stopping_the_repetition(self):
        spawn_occurrences(now=MONDAY)
        second = self.occurrences(self.series)[1]
        make_recurring(second, "", now=MONDAY)
        self.assertFalse(TaskSeries.objects.exists())
        self.assertEqual(list(Task.objects.filter(header="Jour fixe").order_by("start_date")
                              .values_list("start_date", flat=True)), [at(6, 20), at(13, 20)])
        self.assertEqual(spawn_occurrences(now=at(30)), [])
