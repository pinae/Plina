"""Editing tracked time (README: Time sheet): correcting sessions and
entering time that was not tracked live; the task's tracked time follows."""
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.utils import timezone

from plina.scoping import owner_scope
from tasks.models import Tag, Task, TrackingSession
from tasks.services.sessions import SessionError, add_session, change_session, remove_session
from tasks.services.settings import get_settings
from tasks.services.tracking import start_tracking
from tasks.tests.support import APIClient, TestCase

BERLIN = ZoneInfo("Europe/Berlin")
NOW = datetime(2026, 10, 7, 10, 0, tzinfo=BERLIN)


def at(day, hour, minute=0):
    return datetime(2026, 10, day, hour, minute, tzinfo=BERLIN)


def hours(value):
    return timedelta(hours=value)


class SessionCase(TestCase):
    def setUp(self):
        self.zone = timezone.override(BERLIN)
        self.zone.__enter__()
        self.addCleanup(self.zone.__exit__, None, None, None)
        settings = get_settings()
        settings.time_zone = "Europe/Berlin"
        settings.save()
        self.report = Task.objects.create(header="Report", duration=hours(8))
        self.review = Task.objects.create(header="Review", duration=hours(2))

    def spent(self, task):
        task.refresh_from_db()
        return task.time_spent


class ServiceTest(SessionCase):
    def test_entering_time_afterwards_books_it(self):
        add_session(self.report, at(6, 9), at(6, 12, 30), now=NOW)
        self.assertEqual(self.spent(self.report), hours(3.5))

    def test_a_session_that_ran_over_night_is_cut_back(self):
        # Not stopped in the evening: it ran until the next task started.
        with mock.patch("django.utils.timezone.now", return_value=at(6, 17)):
            start_tracking(self.report, now=at(6, 17))
        start_tracking(self.review, now=at(7, 9))
        self.assertEqual(self.spent(self.report), hours(16))
        session = TrackingSession.objects.get(task=self.report)

        change_session(session, at(6, 17), at(6, 18, 30), now=NOW)

        self.assertEqual(self.spent(self.report), hours(1.5))

    def test_giving_the_running_session_an_end_stops_it(self):
        start_tracking(self.report, now=at(6, 17))
        session = TrackingSession.objects.get(task=self.report)
        self.assertEqual(self.spent(self.report), timedelta(0))
        change_session(session, at(6, 16, 30), None, now=NOW)  # it began earlier, still running
        self.assertEqual(self.spent(self.report), timedelta(0))

        change_session(session, at(6, 16, 30), at(6, 18), now=NOW)

        self.assertEqual(self.spent(self.report), hours(1.5))
        self.assertFalse(TrackingSession.objects.filter(end=None).exists())

    def test_removing_takes_the_time_back(self):
        session = add_session(self.report, at(6, 9), at(6, 11), now=NOW)
        add_session(self.report, at(6, 13), at(6, 14), now=NOW)
        remove_session(session, now=NOW)
        self.assertEqual(self.spent(self.report), hours(1))

    def test_tracked_time_never_goes_below_zero(self):
        session = add_session(self.report, at(6, 9), at(6, 11), now=NOW)
        Task.objects.filter(pk=self.report.pk).update(time_spent=hours(1))  # set by hand meanwhile
        remove_session(session, now=NOW)
        self.assertEqual(self.spent(self.report), timedelta(0))

    def test_what_cannot_be(self):
        add_session(self.review, at(6, 13), at(6, 14), now=NOW)
        cases = [
            ((at(6, 9), at(6, 9)), "end", "not after the start"),
            ((at(6, 10), at(6, 9)), "end", "not after the start"),
            ((at(7, 9), at(7, 11)), "end", "future"),
            ((at(7, 11), at(7, 12)), "start", "future"),
            ((at(6, 9), None), "end", "When did it end"),
            ((at(6, 12), at(6, 13, 30)), "detail", "overlaps “Review” (Tue 06/10 13:00 – Tue 06/10 14:00)"),
            ((at(6, 13, 15), at(6, 13, 45)), "detail", "overlaps"),
            ((at(6, 12), at(6, 15)), "detail", "overlaps"),
        ]
        for (start, end), field, message in cases:
            with self.subTest(start=start, end=end):
                with self.assertRaises(SessionError) as refused:
                    add_session(self.report, start, end, now=NOW)
                self.assertIn(message, refused.exception.errors[field])
        # Right before and right after are fine.
        add_session(self.report, at(6, 12), at(6, 13), now=NOW)
        add_session(self.report, at(6, 14), at(6, 15), now=NOW)

    def test_overlapping_the_running_session(self):
        start_tracking(self.review, now=at(7, 9))
        with self.assertRaisesMessage(SessionError, "overlaps “Review” (Wed 07/10 09:00 – now)"):
            add_session(self.report, at(7, 8), at(7, 9, 30), now=NOW)

    def test_a_session_does_not_overlap_itself(self):
        session = add_session(self.report, at(6, 9), at(6, 11), now=NOW)
        change_session(session, at(6, 9, 30), at(6, 11, 30), now=NOW)
        self.assertEqual(self.spent(self.report), hours(2))

    def test_a_done_tasks_figures_follow(self):
        project = Task.objects.create(header="Project")
        Task.objects.filter(pk=self.report.pk).update(parent=project)
        session = add_session(self.report, at(6, 9), at(6, 12), now=NOW)
        for task in (self.report, project):
            Task.objects.filter(pk=task.pk).update(
                completed_at=at(6, 18), completion_time_spent=hours(3), completion_subtree_time_spent=hours(3))

        change_session(session, at(6, 9), at(6, 11), now=NOW)

        self.report.refresh_from_db()
        project.refresh_from_db()
        self.assertEqual(self.report.completion_time_spent, hours(2))
        self.assertEqual(project.completion_subtree_time_spent, hours(2))


class SessionApiTest(SessionCase):
    def setUp(self):
        super().setUp()
        self.api = APIClient()
        self.clock = mock.patch("django.utils.timezone.now", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def test_add_list_change_and_delete(self):
        response = self.api.post("/api/sessions/", {
            "task_id": str(self.report.id), "start": at(6, 9).isoformat(), "end": at(6, 12).isoformat(),
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        created = response.json()
        self.assertEqual((created["task_header"], created["seconds"], created["running"]), ("Report", 3 * 3600, False))
        self.assertEqual(self.spent(self.report), hours(3))

        listed = self.api.get("/api/sessions/", {"task": str(self.report.id)}).json()
        self.assertEqual([item["id"] for item in listed], [created["id"]])

        response = self.api.patch(f"/api/sessions/{created['id']}/", {"end": at(6, 11).isoformat()}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["seconds"], 2 * 3600)
        self.assertEqual(self.spent(self.report), hours(2))

        self.assertEqual(self.api.delete(f"/api/sessions/{created['id']}/").status_code, 204)
        self.assertEqual(self.spent(self.report), timedelta(0))

    def test_the_sessions_of_days(self):
        add_session(self.report, at(5, 22), at(6, 1), now=NOW)  # began on the 5th
        add_session(self.review, at(6, 9), at(6, 10), now=NOW)
        add_session(self.report, at(6, 23, 30), at(6, 23, 50), now=NOW)
        sessions = self.api.get("/api/sessions/", {"from": "2026-10-06", "to": "2026-10-06"}).json()
        self.assertEqual([(item["task_header"], item["start"][11:16]) for item in sessions],
                         [("Review", "09:00"), ("Report", "23:30")])
        self.assertEqual(self.api.get("/api/sessions/", {"from": "6.10."}).status_code, 400)

    def test_refusals_name_the_field(self):
        session = add_session(self.report, at(6, 9), at(6, 12), now=NOW)
        add_session(self.review, at(6, 13), at(6, 14), now=NOW)
        response = self.api.patch(f"/api/sessions/{session.id}/", {"end": at(6, 8).isoformat()}, format="json")
        self.assertEqual(response.json(), {"end": ["The end is not after the start."]})
        response = self.api.patch(f"/api/sessions/{session.id}/", {"end": at(6, 13, 30).isoformat()}, format="json")
        self.assertIn("overlaps “Review”", response.json()["detail"])
        response = self.api.patch(f"/api/sessions/{session.id}/", {"task_id": str(self.review.id)}, format="json")
        self.assertIn("stays with its task", response.json()["task_id"][0])
        response = self.api.post("/api/sessions/", {"task_id": str(self.report.id), "start": at(6, 15).isoformat()},
                                 format="json")
        self.assertIn("When did it end", response.json()["end"][0])
        self.assertEqual(self.spent(self.report), hours(3))

    def test_entered_time_is_on_the_time_sheet(self):
        work = Tag.objects.create(name="Work")
        self.report.tags.set([work])
        self.api.post("/api/sessions/", {
            "task_id": str(self.report.id), "start": at(6, 8).isoformat(), "end": at(6, 16).isoformat(),
        }, format="json")
        [day] = self.api.get("/api/timesheet/", {"from": "2026-10-06", "to": "2026-10-06"}).json()["days"]
        self.assertEqual(day["working_seconds"], 8 * 3600)

    def test_only_your_own_sessions(self):
        other = get_user_model().objects.create_user("other")
        with owner_scope(other):
            theirs = Task.objects.create(header="Their task")
            session = TrackingSession.objects.create(task=theirs, start=at(6, 9), end=at(6, 10))
        self.assertEqual(self.api.get("/api/sessions/", {"from": "2026-10-06"}).json(), [])
        self.assertEqual(self.api.patch(f"/api/sessions/{session.id}/", {"end": at(6, 9, 30).isoformat()},
                                        format="json").status_code, 404)
        response = self.api.post("/api/sessions/", {
            "task_id": str(theirs.id), "start": at(6, 11).isoformat(), "end": at(6, 12).isoformat(),
        }, format="json")
        self.assertEqual(response.status_code, 400)
        # Their time does not block yours.
        add_session(self.report, at(6, 9), at(6, 10), now=NOW)
