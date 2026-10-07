"""Nothing in the Week view overlaps that the user did not put on top of
each other (two appointments at the same time are theirs to keep).

Each test is a way the plan used to show cards on top of each other:
an accepted plan kept the old entry of an appointment that moved, never took
in appointments made after it was accepted (a calendar read, an occurrence
of a recurring appointment), kept a task that is being tracked at the place
it was planned before; and two time buckets at the same time were both
filled."""
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock

from tasks.models import CalendarSubscription, Plan, Task, TimeBucketType
from tasks.services import calendar_sync
from tasks.services.tracking import start_tracking, stop_tracking
from tasks.tests.support import APIClient, TestCase

UTC = dt_timezone.utc
#: Monday 07:00, before the day's bucket (09:00 to 17:00).
NOW = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)


def at(day, hour, minute=0):
    return datetime(2026, 10, day, hour, minute, tzinfo=UTC)


def hours(value):
    return timedelta(hours=value)


class OverlapCase(TestCase):
    def setUp(self):
        self.clock = mock.patch("django.utils.timezone.now", side_effect=lambda: self.now)
        self.now = NOW
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.api = APIClient()
        TimeBucketType.objects.create(name="Work", start_times="every weekday at 09:00", duration=hours(8))
        # Enough to fill Monday's bucket and more.
        for index, header in enumerate(["Design", "Build", "Test", "Docs"]):
            Task.objects.create(header=header, duration=hours(3), priority=9 - index)

    def accept(self):
        alternatives = self.api.post("/api/plan/alternatives/").json()["alternatives"]
        self.assertEqual(self.api.post(f"/api/plans/{alternatives[0]['id']}/accept/").status_code, 200)

    def cards(self):
        """What the Week view shows: (title, start, end), by start."""
        data = self.api.get("/api/plan/").json()
        items = data["appointments"] + [item for bucket in data["buckets"] for item in bucket["items"]]
        cards = []
        for item in items:
            start = datetime.fromisoformat(item["start_time"].replace("Z", "+00:00"))
            cards.append((item["header"], start, start + timedelta(seconds=item["duration"])))
        return sorted(cards, key=lambda card: card[1])

    def assertNoOverlaps(self, cards):
        latest = None
        for card in cards:
            if latest is not None:
                self.assertLessEqual(latest[2], card[1], f"“{card[0]}” overlaps “{latest[0]}”: {cards}")
            if latest is None or card[2] > latest[2]:
                latest = card

    def shown(self, cards, title):
        return [(start, end) for header, start, end in cards if header == title]


class AcceptedPlanTest(OverlapCase):
    def test_a_moved_appointment_is_shown_where_it_is_now(self):
        meeting = Task.objects.create(header="Meeting", is_appointment=True, start_date=at(6, 9),
                                      duration=hours(1))
        self.accept()

        response = self.api.patch(f"/api/tasks/{meeting.id}/", {"start_date": at(5, 10).isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)

        cards = self.cards()
        self.assertEqual(self.shown(cards, "Meeting"), [(at(5, 10), at(5, 11))])
        self.assertNoOverlaps(cards)

    def test_an_appointment_made_after_accepting_is_shown(self):
        self.accept()
        response = self.api.post("/api/tasks/", {
            "header": "Dentist", "is_appointment": True, "start_date": at(5, 11).isoformat(), "duration": "01:00:00",
        }, format="json")
        self.assertEqual(response.status_code, 201)

        cards = self.cards()
        self.assertEqual(self.shown(cards, "Dentist"), [(at(5, 11), at(5, 12))])
        self.assertNoOverlaps(cards)

    def test_occurrences_of_a_recurring_appointment_are_shown(self):
        self.accept()
        response = self.api.post("/api/tasks/", {
            "header": "Standup", "is_appointment": True, "start_date": at(5, 9, 30).isoformat(),
            "duration": "00:15:00", "recurrence": "every weekday at 09:30",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)

        cards = self.cards()
        self.assertIn((at(5, 9, 30), at(5, 9, 45)), self.shown(cards, "Standup"))
        self.assertIn((at(6, 9, 30), at(6, 9, 45)), self.shown(cards, "Standup"))
        self.assertNoOverlaps(cards)

    def test_an_imported_appointment_is_planned_around(self):
        self.accept()
        calendar = CalendarSubscription.objects.create(name="Google", url="https://calendar.google.com/x.ics")
        data = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:review@google.com\r\nSUMMARY:Review\r\n"
                "DTSTART:20261005T100000Z\r\nDTEND:20261005T113000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").encode()
        calendar_sync.sync(calendar, data=data)

        cards = self.cards()
        self.assertEqual(self.shown(cards, "Review"), [(at(5, 10), at(5, 11, 30))])
        self.assertNoOverlaps(cards)

    def test_a_task_being_tracked_is_shown_where_it_is_worked_on(self):
        self.accept()
        docs = Task.objects.get(header="Docs")  # planned last, not on Monday morning
        self.now = at(5, 9, 0)
        start_tracking(docs, now=self.now)
        self.now = at(5, 10, 30)
        stop_tracking(docs, now=self.now)

        # What is left of it goes on from now, not where it was planned before.
        cards = self.cards()
        self.assertEqual(self.shown(cards, "Docs")[0], (at(5, 10, 30), at(5, 12)))
        self.assertNoOverlaps(cards)

    def test_starting_to_track_takes_the_task_out_of_its_old_place(self):
        self.accept()
        docs = Task.objects.get(header="Docs")
        self.now = at(5, 9, 0)
        self.api.post(f"/api/tasks/{docs.id}/track/start/")

        cards = self.cards()
        self.assertEqual(self.shown(cards, "Docs")[0][0], at(5, 9))
        self.assertNoOverlaps(cards)

    def test_entries_of_appointments_that_did_not_change_stay_as_they_are(self):
        Task.objects.create(header="Meeting", is_appointment=True, start_date=at(6, 9), duration=hours(1))
        self.accept()
        plan = Plan.objects.get(is_accepted=True)
        before = list(plan.entries.filter(task__header="Meeting").values("id", "start", "duration", "order"))

        Task.objects.create(header="Newcomer", duration=hours(1))
        self.api.post("/api/tasks/", {"header": "Another", "duration": "01:00:00"}, format="json")

        after = list(plan.entries.filter(task__header="Meeting").values("id", "start", "duration", "order"))
        self.assertEqual(before, after)

    def test_past_appointments_stay_in_the_plan(self):
        meeting = Task.objects.create(header="Meeting", is_appointment=True, start_date=at(5, 9),
                                      duration=hours(1))
        self.accept()
        self.now = at(5, 12)
        self.api.post(f"/api/tasks/{meeting.id}/complete/")
        self.api.post("/api/tasks/", {"header": "Another", "duration": "01:00:00"}, format="json")

        self.assertEqual(self.shown(self.cards(), "Meeting"), [(at(5, 9), at(5, 10))])


class OverlappingBucketsTest(OverlapCase):
    def setUp(self):
        super().setUp()
        # A second kind of time at the same hours as part of the first.
        TimeBucketType.objects.create(name="Focus", start_times="every weekday at 13:00", duration=hours(5))

    def test_time_in_two_buckets_is_planned_once(self):
        self.assertNoOverlaps(self.cards())

    def test_also_in_an_accepted_plan(self):
        self.accept()
        self.assertNoOverlaps(self.cards())

    def test_a_tracked_task_is_not_planned_over_in_the_other_bucket(self):
        docs = Task.objects.get(header="Docs")
        self.now = at(5, 13, 0)
        start_tracking(docs, now=self.now)
        self.assertNoOverlaps(self.cards())
