"""Calendars from other apps (README: Calendar): Plina reads a Google
Calendar through its secret iCal address. Timed events become top-level
appointments, all-day events markers; each keeps a link so the next read
updates instead of adding again; a merge moves the link to your own task."""
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import override_settings
from django.utils import timezone

from tasks.models import (CalendarLink, CalendarSubscription, Marker, Task, TaskDependency, TimeBucket,
                          TimeBucketType, TrackingSession)
from tasks.services import calendar_sync
from tasks.services.bucket_service import gather_time_buckets
from tasks.services.calendar_sync import CalendarError, read_events, sync
from tasks.services.settings import get_settings
from tasks.tests.support import APIClient, TestCase

BERLIN = ZoneInfo("Europe/Berlin")
MONDAY = datetime(2026, 10, 5, 9, 0, tzinfo=BERLIN)


def at(day, hour=0, minute=0):
    return datetime(2026, 10, 1, hour, minute, tzinfo=BERLIN) + timedelta(days=day - 1)


def stamp(moment):
    return moment.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")


def event(uid, summary, start=None, end=None, day=None, days=1, **extra):
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"SUMMARY:{summary}"]
    if day is not None:
        first = at(day).date()
        lines += [f"DTSTART;VALUE=DATE:{first:%Y%m%d}", f"DTEND;VALUE=DATE:{first + timedelta(days=days):%Y%m%d}"]
    else:  # wall-clock time in a zone, like Google writes it
        lines += [f"DTSTART;TZID=Europe/Berlin:{start:%Y%m%dT%H%M%S}", f"DTEND;TZID=Europe/Berlin:{end:%Y%m%dT%H%M%S}"]
    for key, value in extra.items():
        lines.append(f"{key.replace('_', '-')}{'' if value.startswith(';') else ':'}{value}")
    return "\n".join(lines + ["END:VEVENT"])


def feed(*events):
    return ("BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\n"
            + "\n".join(events) + "\nEND:VCALENDAR\n").replace("\n", "\r\n").encode()


TEAM_CALL = event("team@google.com", "Team call", at(6, 10), at(6, 11), RRULE="FREQ=WEEKLY;BYDAY=TU",
                  EXDATE=";TZID=Europe/Berlin:20261020T100000", LOCATION="Room 4")
TEAM_CALL_MOVED = event("team@google.com", "Team call (moved)", at(14, 15), at(14, 16),
                        RECURRENCE_ID=";TZID=Europe/Berlin:20261013T100000")
CONFERENCE = event("conf@google.com", "Conference", day=41, days=3)
LUNCH = event("lunch@google.com", "Lunch with Bob", at(8, 12), at(8, 13), LOCATION="Canteen")


class CalendarTestCase(TestCase):
    def setUp(self):
        self.zone = timezone.override(BERLIN)
        self.zone.__enter__()
        self.addCleanup(self.zone.__exit__, None, None, None)
        settings = get_settings()
        settings.time_zone = "Europe/Berlin"
        settings.save()
        self.calendar = CalendarSubscription.objects.create(
            name="Google", url="https://calendar.google.com/calendar/ical/me/private-secret/basic.ics",
            email="me@example.com", hex_color="#7986cb")

    def read(self, *events, now=MONDAY):
        return sync(self.calendar, now, data=feed(*events))

    def appointment(self, header):
        return Task.objects.get(header=header)


class ReadingTest(CalendarTestCase):
    def test_occurrences_overrides_and_keys(self):
        events = read_events(feed(TEAM_CALL, TEAM_CALL_MOVED, CONFERENCE, LUNCH), MONDAY, at(31), BERLIN)
        team = [(e.header, e.start, e.recurrence_id) for e in events if e.uid == "team@google.com"]
        self.assertEqual(team, [("Team call", at(6, 10), "2026-10-06T08:00:00+00:00"),
                                ("Team call (moved)", at(14, 15), "2026-10-13T08:00:00+00:00"),
                                ("Team call", at(27, 10), "2026-10-27T09:00:00+00:00")])  # the 20th is excepted
        lunch = next(e for e in events if e.uid == "lunch@google.com")
        self.assertEqual((lunch.recurrence_id, lunch.place, lunch.all_day), ("", "Canteen", False))

    def test_all_day_events_from_midnight_to_midnight(self):
        [conference] = read_events(feed(CONFERENCE), MONDAY, at(61), BERLIN)
        self.assertEqual((conference.start, conference.end, conference.all_day), (at(41), at(44), True))

    def test_all_day_events_in_the_calendars_zone_without_one_given(self):
        data = feed(CONFERENCE).replace(b"VERSION:2.0", b"VERSION:2.0\r\nX-WR-TIMEZONE:America/New_York")
        with timezone.override(ZoneInfo("UTC")):
            [conference] = read_events(data, MONDAY, at(61))
        new_york = ZoneInfo("America/New_York")
        self.assertEqual(conference.start, datetime(2026, 11, 10, tzinfo=new_york))

    def test_declined_and_cancelled_ones_are_left_out(self):
        declined = event("bob@google.com", "Bob's party", at(9, 18), at(9, 22),
                         ATTENDEE=";CN=me@example.com;PARTSTAT=DECLINED:mailto:me@example.com")
        cancelled = event("off@google.com", "Off", at(9, 9), at(9, 10), STATUS="CANCELLED")
        unanswered = event("new@google.com", "New", at(9, 9), at(9, 10),
                           ATTENDEE=";PARTSTAT=NEEDS-ACTION:mailto:me@example.com")
        events = read_events(feed(declined, cancelled, unanswered), MONDAY, at(31), BERLIN, "Me@Example.com")
        self.assertEqual([e.header for e in events], ["New"])

    def test_not_a_calendar(self):
        with self.assertRaisesMessage(CalendarError, "not a calendar"):
            read_events(b"<html>Sign in</html>", MONDAY, at(31), BERLIN)


class SyncTest(CalendarTestCase):
    def test_all_day_events_on_the_users_days_whatever_zone_is_active(self):
        # E.g. read before the app told the server its zone in this request.
        with timezone.override(ZoneInfo("UTC")):
            self.read(CONFERENCE)
        self.assertEqual(Marker.objects.get().start, at(41))

    def test_timed_events_become_appointments_all_day_ones_markers(self):
        result = self.read(TEAM_CALL, TEAM_CALL_MOVED, CONFERENCE, LUNCH)
        self.assertEqual(result.created, 1 + 8 + 1)  # lunch, 8 team calls (60 days, one excepted), the conference
        lunch = self.appointment("Lunch with Bob")
        self.assertEqual((lunch.is_appointment, lunch.start_date, lunch.duration, lunch.place, lunch.parent_id),
                         (True, at(8, 12), timedelta(hours=1), "Canteen", None))
        self.assertEqual(bytes(lunch.color).hex(), "7986cb")
        conference = Marker.objects.get()
        self.assertEqual((conference.title, conference.start, conference.duration), ("Conference", at(41),
                                                                                     timedelta(days=3)))
        self.assertEqual(Task.objects.filter(header="Team call (moved)").get().start_date, at(14, 15))

    def test_reading_again_adds_nothing(self):
        self.read(TEAM_CALL, CONFERENCE, LUNCH)
        counts = (Task.objects.count(), Marker.objects.count(), CalendarLink.objects.count())
        result = self.read(TEAM_CALL, CONFERENCE, LUNCH, now=MONDAY + timedelta(minutes=15))
        self.assertFalse(result.changed)
        self.assertEqual((Task.objects.count(), Marker.objects.count(), CalendarLink.objects.count()), counts)

    def test_time_and_place_follow_the_calendar_your_words_stay_yours(self):
        self.read(LUNCH)
        lunch = self.appointment("Lunch with Bob")
        lunch.description = "Bring the samples"  # yours
        lunch.save()
        moved = event("lunch@google.com", "Lunch with Bob and Alice", at(8, 13), at(8, 14), LOCATION="Pizzeria",
                      DESCRIPTION="Table for 3")
        self.read(moved)
        lunch.refresh_from_db()
        self.assertEqual((lunch.header, lunch.start_date, lunch.place, lunch.description),
                         ("Lunch with Bob and Alice", at(8, 13), "Pizzeria", "Bring the samples"))
        link = lunch.calendar_links.get()
        self.assertEqual((link.pending, link.data["description"]), (["description"], "Table for 3"))

    def test_an_appointment_moved_in_plina_stays_until_the_calendar_moves_it(self):
        self.read(LUNCH)
        lunch = self.appointment("Lunch with Bob")
        lunch.start_date = at(8, 12, 30)
        lunch.save()
        self.read(LUNCH)  # unchanged in the calendar
        lunch.refresh_from_db()
        self.assertEqual(lunch.start_date, at(8, 12, 30))

    def test_a_gone_event_takes_along_what_nobody_worked_on(self):
        worked_on = event("work@google.com", "Workshop", at(9, 9), at(9, 12))
        self.read(LUNCH, worked_on, CONFERENCE)
        workshop = self.appointment("Workshop")
        workshop.time_spent = timedelta(minutes=30)
        workshop.save()
        self.read()  # all three gone
        self.assertFalse(Task.objects.filter(header="Lunch with Bob").exists())
        self.assertFalse(Marker.objects.exists())
        self.assertTrue(Task.objects.filter(header="Workshop").exists())  # kept, no longer linked
        self.assertFalse(CalendarLink.objects.exists())

    def test_a_deleted_import_stays_away(self):
        self.read(LUNCH)
        self.appointment("Lunch with Bob").delete()
        self.read(LUNCH)
        self.assertFalse(Task.objects.filter(header="Lunch with Bob").exists())

    def test_past_appointments_complete_themselves(self):
        self.read(LUNCH)
        self.read(LUNCH, now=at(8, 13, 30))
        self.assertEqual(self.appointment("Lunch with Bob").completed_at, at(8, 13))

    def test_a_moved_conference_moves_its_named_deadlines(self):
        self.read(CONFERENCE)
        conference = Marker.objects.get()
        slides = Task.objects.create(header="Slides", deadline_marker=conference, latest_finish_date=conference.start)
        self.read(event("conf@google.com", "Conference", day=48, days=3))
        slides.refresh_from_db()
        self.assertEqual(slides.latest_finish_date, at(48))


@override_settings(SESSION_COOKIE_AGE=365 * 24 * 3600)
class ApiTest(CalendarTestCase):
    def setUp(self):
        super().setUp()
        self.api = APIClient()
        self.now = MONDAY

    def request(self, method, path, body=None):
        with mock.patch("django.utils.timezone.now", side_effect=lambda: self.now):
            return getattr(self.api, method)(path, body, format="json")

    def test_adding_a_calendar_reads_it_and_keeps_the_address_secret(self):
        with mock.patch.object(calendar_sync, "fetch", return_value=feed(LUNCH)) as fetch:
            response = self.request("post", "/api/calendars/", {
                "name": "Work", "url": "webcal://calendar.google.com/calendar/ical/x/private-y/basic.ics"})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn("url", response.data)
        self.assertEqual(response.data["url_hint"], "calendar.google.com …")
        fetch.assert_called_once_with("https://calendar.google.com/calendar/ical/x/private-y/basic.ics")
        task = next(t for t in self.request("get", "/api/tasks/").data if t["header"] == "Lunch with Bob")
        self.assertEqual((task["place"], task["calendar"]["name"], task["calendar"]["pending"]),
                         ("Canteen", "Work", []))

    def test_only_https_addresses(self):
        response = self.request("post", "/api/calendars/", {"name": "x", "url": "http://10.0.0.1/cal.ics"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("https://", str(response.data["url"]))

    def test_never_an_address_inside_the_servers_network(self):
        with mock.patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("10.0.0.5", 443))]):
            with self.assertRaisesMessage(CalendarError, "not a public address"):
                calendar_sync.check_url("https://intranet.example.com/cal.ics")

    def test_reading_when_due_and_on_request(self):
        with mock.patch.object(calendar_sync, "fetch", return_value=feed(LUNCH)) as fetch:
            self.assertTrue(self.request("post", "/api/calendars/sync/").data["changed"])
            self.now = MONDAY + timedelta(minutes=5)
            self.assertFalse(self.request("post", "/api/calendars/sync/").data["changed"])
            self.assertEqual(fetch.call_count, 1)  # read 5 minutes ago
            self.request("post", "/api/calendars/sync/", {"force": True})
            self.assertEqual(fetch.call_count, 2)
        with mock.patch.object(calendar_sync, "fetch", side_effect=CalendarError("The calendar answered 404.")):
            data = self.request("post", "/api/calendars/sync/", {"force": True}).data
        self.assertEqual(data["calendars"][0]["last_error"], "The calendar answered 404.")

    def test_removing_a_calendar_removes_its_coming_untouched_events(self):
        sync(self.calendar, MONDAY, data=feed(LUNCH, CONFERENCE))
        response = self.request("delete", f"/api/calendars/{self.calendar.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Task.objects.exists() or Marker.objects.exists() or CalendarSubscription.objects.exists())

    def test_merging_your_task_with_the_invitation(self):
        mine = self.request("post", "/api/tasks/", {
            "header": "Lunch Bob", "description": "Ask about the samples", "is_appointment": True,
            "start_date": at(8, 12).isoformat(), "duration": "01:30:00"}).data
        other = self.request("post", "/api/tasks/", {"header": "Samples", "duration": "00:30:00"}).data
        self.request("post", "/api/dependencies/", {"predecessor": other["id"], "successor": mine["id"]})
        sync(self.calendar, MONDAY, data=feed(LUNCH))
        invitation = Task.objects.get(header="Lunch with Bob")
        TrackingSession.objects.create(task=invitation, start=at(5, 8), end=at(5, 8, 10))
        invitation.time_spent = timedelta(minutes=10)
        invitation.save()
        response = self.request("post", f"/api/tasks/{mine['id']}/merge/", {
            "other_id": str(invitation.id),
            "values": {"header": "Lunch with Bob", "place": "Canteen", "duration": "01:00:00"}})
        self.assertEqual(response.status_code, 200, response.data)
        kept = Task.objects.get(id=mine["id"])
        self.assertEqual((kept.header, kept.description, kept.place, kept.duration, kept.time_spent),
                         ("Lunch with Bob", "Ask about the samples", "Canteen", timedelta(hours=1),
                          timedelta(minutes=10)))
        self.assertFalse(Task.objects.filter(id=invitation.id).exists())
        self.assertEqual(TrackingSession.objects.get().task_id, kept.id)
        self.assertTrue(TaskDependency.objects.filter(predecessor_id=other["id"], successor=kept).exists())
        self.assertEqual(response.data["task"]["calendar"]["name"], "Google")
        # The next read updates your task, it adds no new one.
        sync(self.calendar, MONDAY, data=feed(event("lunch@google.com", "Lunch with Bob", at(8, 14), at(8, 15),
                                                     LOCATION="Canteen")))
        kept.refresh_from_db()
        self.assertEqual((kept.start_date, Task.objects.filter(header="Lunch with Bob").count()), (at(8, 14), 1))
        # Gone from the calendar: your task stays.
        sync(self.calendar, MONDAY, data=feed())
        self.assertTrue(Task.objects.filter(id=kept.id).exists())

    def test_merge_refusals(self):
        parent = self.request("post", "/api/tasks/", {"header": "Project"}).data
        child = self.request("post", "/api/tasks/", {"header": "Step", "parent_id": parent["id"]}).data
        response = self.request("post", f"/api/tasks/{parent['id']}/merge/", {"other_id": child["id"], "values": {}})
        self.assertEqual(response.status_code, 400)
        self.assertIn("is part of", response.data["detail"])
        sync(self.calendar, MONDAY, data=feed(LUNCH, event("w@google.com", "Workshop", at(9, 9), at(9, 12))))
        lunch, workshop = Task.objects.get(header="Lunch with Bob"), Task.objects.get(header="Workshop")
        response = self.request("post", f"/api/tasks/{lunch.id}/merge/", {"other_id": str(workshop.id),
                                                                          "values": {}})
        self.assertIn("Both come from a calendar", response.data["detail"])

    def test_comparing_with_the_calendar_settles_its_changes(self):
        sync(self.calendar, MONDAY, data=feed(LUNCH))
        lunch = Task.objects.get(header="Lunch with Bob")
        lunch.header = "Lunch"
        lunch.save()
        sync(self.calendar, MONDAY, data=feed(event("lunch@google.com", "Lunch with Bob & Alice", at(8, 12),
                                                    at(8, 13), LOCATION="Canteen")))
        self.assertEqual(lunch.calendar_links.get().pending, ["header"])
        response = self.request("patch", f"/api/tasks/{lunch.id}/", {"header": "Lunch with Bob & Alice",
                                                                    "calendar_resolved": True})
        self.assertEqual(response.data["calendar"]["pending"], [])


@override_settings(SESSION_COOKIE_AGE=365 * 24 * 3600)
class MarkerTest(CalendarTestCase):
    def setUp(self):
        super().setUp()
        self.api = APIClient()

    def test_markers_with_a_time_and_as_named_deadlines(self):
        response = self.api.post("/api/markers/", {"title": "Abstract due", "start": at(20, 14).isoformat(),
                                                   "duration": "00:00:00"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["all_day"])
        marker = response.data["id"]
        task = self.api.post("/api/tasks/", {"header": "Write abstract", "deadline_marker_id": marker},
                             format="json").data
        self.assertEqual(datetime.fromisoformat(task["latest_finish_date"]), at(20, 14))
        self.assertEqual(task["deadline_marker"]["title"], "Abstract due")
        self.api.patch(f"/api/markers/{marker}/", {"start": at(21, 12).isoformat()}, format="json")
        task = self.api.get(f"/api/tasks/{task['id']}/").data
        self.assertEqual(datetime.fromisoformat(task["latest_finish_date"]), at(21, 12))
        # A date of its own: no longer the marker's.
        task = self.api.patch(f"/api/tasks/{task['id']}/", {"latest_finish_date": at(19).isoformat()},
                              format="json").data
        self.assertIsNone(task["deadline_marker"])

    def test_only_markers_in_a_time_frame(self):
        Marker.objects.create(title="Before", start=at(1), duration=timedelta(days=1))
        Marker.objects.create(title="Spanning", start=at(3), duration=timedelta(days=5))
        Marker.objects.create(title="After", start=at(20), duration=timedelta(days=1))
        titles = [m["title"] for m in self.api.get(
            f"/api/markers/?from={at(5).isoformat().replace('+', '%2B')}&to={at(12).isoformat().replace('+', '%2B')}"
        ).data]
        self.assertEqual(titles, ["Spanning"])

    def test_a_marker_becomes_a_special_bucket_and_stays_linked(self):
        sync(self.calendar, MONDAY, data=feed(CONFERENCE))
        marker = Marker.objects.get()
        response = self.api.post(f"/api/markers/{marker.id}/convert/", {
            "start_times": "every day at 9:00", "duration": "08:00:00"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data["name"], response.data["is_special"], response.data["calendar"]["name"]),
                         ("Conference", True, "Google"))
        self.assertFalse(Marker.objects.exists())
        # The calendar moves it: the special bucket moves.
        sync(self.calendar, MONDAY, data=feed(event("conf@google.com", "Conference", day=48, days=3)))
        special = TimeBucketType.objects.get(name="Conference")
        self.assertEqual((special.special_start, special.special_end), (at(48), at(51)))
        sync(self.calendar, MONDAY, data=feed())  # gone from the calendar: made by you, it stays
        self.assertTrue(TimeBucketType.objects.filter(name="Conference").exists())


class SpecialBucketTest(CalendarTestCase):
    def setUp(self):
        super().setUp()
        self.regular = TimeBucketType.objects.create(name="Deep work", start_times="every day at 9:00",
                                                     duration=timedelta(hours=4), anchor=at(1))
        self.evening = TimeBucketType.objects.create(name="Writing", start_times="every day at 19:00",
                                                     duration=timedelta(hours=2), anchor=at(1))

    def buckets(self, start=at(5), days=4):
        return [(b.type.name, b.start_date, b.duration) for b in gather_time_buckets(start, start + timedelta(days=days))]

    def test_the_regular_buckets_give_way_in_its_frame(self):
        TimeBucketType.objects.create(name="Travel", start_times="every day at 10:00", duration=timedelta(hours=3),
                                      special_start=at(6), special_end=at(8))
        TimeBucket.objects.create(type=self.regular, start_date=at(6, 14), duration=timedelta(hours=1))  # by hand
        buckets = self.buckets()
        self.assertEqual([b for b in buckets if at(6) <= b[1] < at(8)],
                         [("Travel", at(6, 10), timedelta(hours=3)), ("Travel", at(7, 10), timedelta(hours=3))])
        self.assertIn(("Deep work", at(8, 9), timedelta(hours=4)), buckets)  # after the frame
        self.assertIn(("Writing", at(5, 19), timedelta(hours=2)), buckets)  # before it

    def test_without_a_rule_the_whole_frame_and_cut_to_it(self):
        TimeBucketType.objects.create(name="Hackathon", special_start=at(6, 10), special_end=at(6, 22),
                                      duration=timedelta(hours=4))
        self.assertIn(("Hackathon", at(6, 10), timedelta(hours=12)), self.buckets())
        TimeBucketType.objects.create(name="Fair", start_times="every day at 8:00", duration=timedelta(hours=10),
                                      special_start=at(7, 12), special_end=at(7, 16))
        self.assertIn(("Fair", at(7, 12), timedelta(hours=4)), self.buckets())

    def test_the_api_takes_the_frame(self):
        api = APIClient()
        response = api.post("/api/buckettypes/", {"name": "Travel", "start_times": "", "duration": "08:00:00",
                                                  "special_start": at(8, 18).isoformat(),
                                                  "special_end": at(8, 9).isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("after the start", str(response.data["special_end"]))


@override_settings(SESSION_COOKIE_AGE=365 * 24 * 3600)
class IsolationTest(CalendarTestCase):
    def test_bob_sees_none_of_it(self):
        from django.contrib.auth.models import User
        from rest_framework.test import APIClient as Client
        sync(self.calendar, MONDAY, data=feed(LUNCH, CONFERENCE))
        bob = Client()
        bob.force_login(User.objects.create_user("bob"))
        self.assertEqual(bob.get("/api/calendars/").data, [])
        self.assertEqual(bob.get("/api/markers/").data, [])
        marker = Marker.objects.get()
        self.assertEqual(bob.get(f"/api/markers/{marker.id}/").status_code, 404)
        self.assertEqual(bob.post(f"/api/markers/{marker.id}/convert/", {}, format="json").status_code, 404)
        self.assertEqual(bob.delete(f"/api/calendars/{self.calendar.id}/").status_code, 404)
        own = bob.post("/api/tasks/", {"header": "Bob's"}, format="json").data["id"]
        lunch = Task.objects.get(header="Lunch with Bob")
        response = bob.post(f"/api/tasks/{own}/merge/", {"other_id": str(lunch.id), "values": {}}, format="json")
        self.assertEqual(response.status_code, 400)  # hers does not exist for him
        self.assertEqual(bob.post("/api/tasks/", {"header": "x", "deadline_marker_id": str(marker.id)},
                                  format="json").status_code, 400)
        self.assertTrue(Task.objects.filter(id=lunch.id).exists())
