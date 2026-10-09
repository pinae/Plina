"""Events answered "maybe" in the calendar (README: Unplanned appointments)
come in unplanned: reminders that block no time. Your own answer in the
calendar counts (your address there); a later answer there carries over,
a decision in Plina is not undone by the next read."""
from tasks.models import CalendarLink, Task
from tasks.services.calendar_sync import read_events
from tasks.tests.support import APIClient
from tasks.tests.test_calendar import BERLIN, MONDAY, CalendarTestCase, at, event, feed


def defense(answer, uid="defense@google.com", **extra):
    return event(uid, "Claire's PhD defense", at(19, 14), at(19, 16),
                 ATTENDEE=f";CN=me@example.com;PARTSTAT={answer}:mailto:me@example.com", **extra)


class MaybeTest(CalendarTestCase):
    def test_reading_tells_your_maybe(self):
        events = read_events(feed(defense("TENTATIVE"), defense("ACCEPTED", uid="yes@google.com"),
                                  defense("NEEDS-ACTION", uid="open@google.com")), MONDAY, at(31), BERLIN,
                             "Me@Example.com")
        self.assertEqual({e.uid: e.maybe for e in events},
                         {"defense@google.com": True, "yes@google.com": False, "open@google.com": False})

    def test_a_maybe_comes_in_unplanned_a_yes_planned(self):
        self.read(defense("TENTATIVE"), defense("ACCEPTED", uid="yes@google.com"))
        self.assertEqual({link.uid: link.task.is_unplanned for link in CalendarLink.objects.all()},
                         {"defense@google.com": True, "yes@google.com": False})

    def test_a_later_answer_there_carries_over(self):
        self.read(defense("TENTATIVE"))
        self.assertTrue(self.appointment("Claire's PhD defense").is_unplanned)
        self.read(defense("ACCEPTED"))
        self.assertFalse(self.appointment("Claire's PhD defense").is_unplanned)
        self.read(defense("TENTATIVE"))
        self.assertTrue(self.appointment("Claire's PhD defense").is_unplanned)

    def test_joining_in_plina_is_not_undone_by_the_next_read(self):
        self.read(defense("TENTATIVE"))
        task = self.appointment("Claire's PhD defense")
        APIClient().patch(f"/api/tasks/{task.id}/", {"is_unplanned": False}, format="json")
        self.read(defense("TENTATIVE"))  # still "maybe" there
        self.assertFalse(self.appointment("Claire's PhD defense").is_unplanned)

    def test_occurrences_of_a_repeating_event_follow_their_answer(self):
        series = event("seminar@google.com", "Seminar", at(6, 10), at(6, 11), RRULE="FREQ=WEEKLY;COUNT=2",
                       ATTENDEE=";PARTSTAT=TENTATIVE:mailto:me@example.com")
        accepted = event("seminar@google.com", "Seminar", at(13, 10), at(13, 11),
                         RECURRENCE_ID=";TZID=Europe/Berlin:20261013T100000",
                         ATTENDEE=";PARTSTAT=ACCEPTED:mailto:me@example.com")
        self.read(series, accepted)
        seminars = Task.objects.filter(header="Seminar").order_by("start_date")
        self.assertEqual([task.is_unplanned for task in seminars], [True, False])

    def test_without_your_address_the_calendars_own_name_tells(self):
        # Google names your main calendar after your address.
        self.calendar.email = ""
        self.calendar.save()
        data = feed(defense("TENTATIVE")).replace(b"VERSION:2.0", b"VERSION:2.0\r\nX-WR-CALNAME:me@example.com")
        from tasks.services.calendar_sync import sync
        sync(self.calendar, MONDAY, data=data)
        self.assertTrue(self.appointment("Claire's PhD defense").is_unplanned)
