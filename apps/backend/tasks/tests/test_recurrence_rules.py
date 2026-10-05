"""Recurrence rules in plain language (tasks/services/recurrence.py): what
the user types, the occurrences it means, and why a rule is not understood.

OldLibraryExamplesTest walks through the examples of the ``recurrent``
library Plina used before, in its own notation: every phrase it understood
still works."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dateutil import rrule
from django.test import SimpleTestCase

from tasks.services.recurrence import RecurrenceError, describe, next_occurrence, occurrences, parse_rule

BERLIN = ZoneInfo("Europe/Berlin")
# Monday, 5 October 2026, 09:00 in Berlin.
MONDAY = datetime(2026, 10, 5, 9, 0, tzinfo=BERLIN)
UNTIL = datetime(2031, 12, 31, tzinfo=BERLIN)


def found(text, anchor=MONDAY, start=None, end=UNTIL):
    return occurrences(parse_rule(text), anchor, start or anchor, end, BERLIN)


def upcoming(text, anchor=MONDAY, count=4, start=None):
    return [occurrence.strftime("%a %d.%m.%Y %H:%M") for occurrence in found(text, anchor, start)[:count]]


def days(text, count=None, **kwargs):
    moments = found(text, **kwargs)
    return [moment.strftime("%d.%m.%Y") for moment in moments[:count]]


class TheUsersExamplesTest(SimpleTestCase):
    def test_every_tuesday_2000(self):
        self.assertEqual(upcoming("every tuesday 20:00"),
                         ["Tue 06.10.2026 20:00", "Tue 13.10.2026 20:00", "Tue 20.10.2026 20:00", "Tue 27.10.2026 20:00"])

    def test_every_4_weeks_on_tuesday_1400(self):
        self.assertEqual(upcoming("every 4 weeks on tuesday 14:00"),
                         ["Tue 06.10.2026 14:00", "Tue 03.11.2026 14:00", "Tue 01.12.2026 14:00", "Tue 29.12.2026 14:00"])

    def test_every_first_sunday_each_month_at_1230(self):
        self.assertEqual(upcoming("every first sunday each month at 12:30"),
                         ["Sun 01.11.2026 12:30", "Sun 06.12.2026 12:30", "Sun 03.01.2027 12:30", "Sun 07.02.2027 12:30"])


class PhrasingsTest(SimpleTestCase):
    def test_times_are_24h_with_or_without_at(self):
        for text in ("every day at 7:30", "every day 07:30", "daily at 7:30", "every day at 7.30 am"):
            self.assertEqual(upcoming(text, count=1), ["Tue 06.10.2026 07:30"], text)
        self.assertEqual(upcoming("every day at 7:30 pm", count=1), ["Mon 05.10.2026 19:30"])
        self.assertEqual(upcoming("every day at 8pm", count=1), ["Mon 05.10.2026 20:00"])
        self.assertEqual(upcoming("every day at 18", count=1), ["Mon 05.10.2026 18:00"])
        self.assertEqual(upcoming("every day at noon", count=1), ["Mon 05.10.2026 12:00"])

    def test_times_of_day_in_words(self):
        self.assertEqual(upcoming("every tuesday evening", count=1), ["Tue 06.10.2026 18:00"])
        self.assertEqual(upcoming("every morning", count=1), ["Tue 06.10.2026 08:00"])
        self.assertEqual(upcoming("weekdays in the afternoon", count=1), ["Mon 05.10.2026 14:00"])
        self.assertEqual(upcoming("every day at 7 in the evening", count=1), ["Mon 05.10.2026 19:00"])
        self.assertEqual(upcoming("every day at 10 at night", count=1), ["Mon 05.10.2026 22:00"])
        self.assertEqual(upcoming("every day at 12 noon", count=2), ["Mon 05.10.2026 12:00", "Tue 06.10.2026 12:00"])

    def test_several_times_a_day(self):
        self.assertEqual(upcoming("every weekday at 9:00 and 14:30", count=3),
                         ["Mon 05.10.2026 09:00", "Mon 05.10.2026 14:30", "Tue 06.10.2026 09:00"])
        self.assertEqual(upcoming("every day at 9 and 14", count=3),
                         ["Mon 05.10.2026 09:00", "Mon 05.10.2026 14:00", "Tue 06.10.2026 09:00"])

    def test_weekdays_in_many_spellings(self):
        expected = ["Tue 06.10.2026 20:00", "Thu 08.10.2026 20:00", "Tue 13.10.2026 20:00"]
        for text in ("every tuesday and thursday at 20:00", "every tue, thu at 20:00", "Tuesdays and Thursdays 20:00",
                     "weekly on tuesday & thursday at 20:00", "every week on Tuesday and Thursday 20:00",
                     "every tuesdy and thursday at 20:00"):
            self.assertEqual(upcoming(text, count=3), expected, text)
        self.assertEqual(upcoming("every weekday at 8:00", count=5)[-1], "Mon 12.10.2026 08:00")
        self.assertEqual(upcoming("every weekend at 10:00", count=2), ["Sat 10.10.2026 10:00", "Sun 11.10.2026 10:00"])
        self.assertEqual(upcoming("every business day at 8:00", count=5)[-1], "Mon 12.10.2026 08:00")
        self.assertEqual(upcoming("from monday to wednesday at 8:00", count=3)[-1], "Mon 12.10.2026 08:00")

    def test_intervals(self):
        self.assertEqual(upcoming("every other week on monday at 9:00", count=3),
                         ["Mon 05.10.2026 09:00", "Mon 19.10.2026 09:00", "Mon 02.11.2026 09:00"])
        # The first is the next one after the anchor (Monday 5 October 09:00), counted on from there.
        self.assertEqual(upcoming("every 3 days at 6:00", count=2), ["Tue 06.10.2026 06:00", "Fri 09.10.2026 06:00"])
        made_on_wednesday = datetime(2026, 10, 7, 9, 0, tzinfo=BERLIN)
        self.assertEqual(upcoming("every 4 weeks on tuesday at 14:00", made_on_wednesday, count=2),
                         ["Tue 13.10.2026 14:00", "Tue 10.11.2026 14:00"])
        self.assertEqual(upcoming("every 2 months on the first monday", datetime(2026, 10, 20, tzinfo=BERLIN), count=2),
                         ["Mon 02.11.2026 00:00", "Mon 04.01.2027 00:00"])
        self.assertEqual(upcoming("every 2 months on the first monday at 10:00", count=2),
                         ["Mon 05.10.2026 10:00", "Mon 07.12.2026 10:00"])
        self.assertEqual(upcoming("every second friday at 9:00", count=2), ["Fri 09.10.2026 09:00", "Fri 23.10.2026 09:00"])
        self.assertEqual(upcoming("fortnightly on wednesday at 9:00", count=2),
                         ["Wed 07.10.2026 09:00", "Wed 21.10.2026 09:00"])
        self.assertEqual(upcoming("every other hour", count=3),
                         ["Mon 05.10.2026 09:00", "Mon 05.10.2026 11:00", "Mon 05.10.2026 13:00"])

    def test_days_of_the_month_and_year(self):
        self.assertEqual(upcoming("every month on the 15th at 10:00", count=2),
                         ["Thu 15.10.2026 10:00", "Sun 15.11.2026 10:00"])
        self.assertEqual(upcoming("every 15th of the month", count=1), ["Thu 15.10.2026 00:00"])
        self.assertEqual(upcoming("every last friday of the month at 16:00", count=2),
                         ["Fri 30.10.2026 16:00", "Fri 27.11.2026 16:00"])
        self.assertEqual(upcoming("every last day of the month", count=2),
                         ["Sat 31.10.2026 00:00", "Mon 30.11.2026 00:00"])
        self.assertEqual(upcoming("the last workday of the month", count=2),
                         ["Fri 30.10.2026 00:00", "Mon 30.11.2026 00:00"])
        self.assertEqual(upcoming("every year on march 3 at 9:00", count=1), ["Wed 03.03.2027 09:00"])
        self.assertEqual(upcoming("every 24th of december", count=1), ["Thu 24.12.2026 00:00"])

    def test_without_a_time_from_the_start_of_the_day(self):
        self.assertEqual(upcoming("every tuesday", count=1), ["Tue 06.10.2026 00:00"])
        self.assertEqual(upcoming("every hour", count=1), ["Mon 05.10.2026 09:00"])  # on the hour

    def test_wall_clock_time_across_daylight_saving(self):
        # The clocks go back on 25 October: 20:00 stays 20:00.
        moments = found("every tuesday at 20:00", end=datetime(2026, 11, 1, tzinfo=BERLIN))
        self.assertEqual([o.hour for o in moments], [20, 20, 20, 20])
        self.assertEqual(moments[-1].utcoffset().total_seconds(), 3600)

    def test_next_occurrence(self):
        rule = parse_rule("every 4 weeks on tuesday at 14:00")
        after = datetime(2026, 10, 6, 14, 0, tzinfo=BERLIN)
        self.assertEqual(next_occurrence(rule, MONDAY, after, BERLIN), datetime(2026, 11, 3, 14, 0, tzinfo=BERLIN))
        self.assertIsNone(next_occurrence(parse_rule("fridays twice"), MONDAY, datetime(2026, 10, 16, 1, tzinfo=BERLIN),
                                          BERLIN))


class AnchorTest(SimpleTestCase):
    """The anchor keeps the rhythm, also when asked about earlier times."""

    def test_the_rhythm_from_the_anchor_reaches_back(self):
        three_weeks_earlier = MONDAY - timedelta(weeks=3)
        self.assertEqual(upcoming("every other week on monday at 9:00", start=three_weeks_earlier, count=3),
                         ["Mon 21.09.2026 09:00", "Mon 05.10.2026 09:00", "Mon 19.10.2026 09:00"])
        self.assertEqual(upcoming("every 3 days at 6:00", start=MONDAY - timedelta(days=4), count=2),
                         ["Sat 03.10.2026 06:00", "Tue 06.10.2026 06:00"])
        self.assertEqual(upcoming("every 2 months on the 31st", start=datetime(2026, 7, 1, tzinfo=BERLIN), count=3),
                         ["Mon 31.08.2026 00:00", "Sat 31.10.2026 00:00", "Thu 31.12.2026 00:00"])

    def test_a_counted_or_started_series_begins_at_its_start(self):
        a_week_earlier = MONDAY - timedelta(weeks=1)
        self.assertEqual(upcoming("every day at 9:00 for 3 times", start=a_week_earlier),
                         ["Mon 05.10.2026 09:00", "Tue 06.10.2026 09:00", "Wed 07.10.2026 09:00"])
        self.assertEqual(upcoming("every day at 9:00 starting tomorrow", start=a_week_earlier, count=1),
                         ["Tue 06.10.2026 09:00"])


def rfc(rule):
    """A rule in the ``recurrent`` library's test notation (comma lists as sets)."""
    names = {rrule.YEARLY: "yearly", rrule.MONTHLY: "monthly", rrule.WEEKLY: "weekly", rrule.DAILY: "daily",
             rrule.HOURLY: "hourly"}
    codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    fields = {"freq": names[rule.freq], "interval": rule.interval}
    if rule.weekdays:
        fields["byday"] = {f"{nth or ''}{codes[day]}" for day, nth in rule.weekdays}
    for name, values in (("bymonthday", rule.monthdays), ("byyearday", rule.yeardays), ("byweekno", rule.weeknos),
                         ("bymonth", rule.months), ("bysetpos", rule.setpos)):
        if values:
            fields[name] = {str(value) for value in values}
    if rule.times:
        fields["byhour"] = {str(hour) for hour, _ in rule.times}
        fields["byminute"] = {str(minute) for _, minute in rule.times}
    if rule.count:
        fields["count"] = rule.count
    return fields


def expected(**fields):
    return {name: set(value.split(",")) if name.startswith("by") else value for name, value in fields.items()}


class OldLibraryExamplesTest(SimpleTestCase):
    """The recurring examples of the ``recurrent`` library (its test.py),
    with the result it expected."""
    EXAMPLES = [
        ("daily", dict(freq="daily", interval=1)),
        ("each day", dict(freq="daily", interval=1)),
        ("everyday", dict(freq="daily", interval=1)),
        ("every day twice", dict(freq="daily", interval=1, count=2)),
        ("every day for 3x", dict(freq="daily", interval=1, count=3)),
        ("every day for 4 times", dict(freq="daily", interval=1, count=4)),
        ("every day for 5 occurrences", dict(freq="daily", interval=1, count=5)),
        ("every other day", dict(freq="daily", interval=2)),
        ("every 4 days", dict(freq="daily", interval=4)),
        ("every 4th day", dict(freq="daily", interval=4)),
        ("tuesdays", dict(freq="weekly", interval=1, byday="TU")),
        ("weekends", dict(freq="weekly", interval=1, byday="SA,SU")),
        ("every other weekend", dict(freq="weekly", interval=2, byday="SA,SU")),
        ("every other week on weekend", dict(freq="weekly", interval=2, byday="SA,SU")),
        ("every 4 weekends", dict(freq="weekly", interval=4, byday="SA,SU")),
        ("every 4 weeks on weekends", dict(freq="weekly", interval=4, byday="SA,SU")),
        ("every 4th week on weekends", dict(freq="weekly", interval=4, byday="SA,SU")),
        ("weekdays", dict(freq="weekly", interval=1, byday="MO,TU,WE,TH,FR")),
        ("every weekday", dict(freq="weekly", interval=1, byday="MO,TU,WE,TH,FR")),
        ("tuesdays and thursdays", dict(freq="weekly", interval=1, byday="TU,TH")),
        ("weekly on wednesdays", dict(freq="weekly", interval=1, byday="WE")),
        ("weekly on wednesdays and fridays", dict(freq="weekly", interval=1, byday="WE,FR")),
        ("every sunday and saturday", dict(freq="weekly", interval=1, byday="SU,SA")),
        ("every wed", dict(freq="weekly", interval=1, byday="WE")),
        ("every wed.", dict(freq="weekly", interval=1, byday="WE")),
        ("every wednsday", dict(freq="weekly", interval=1, byday="WE")),
        ("every week on tues", dict(freq="weekly", interval=1, byday="TU")),
        ("once a week on sunday", dict(freq="weekly", interval=1, byday="SU")),
        ("every other week on mon", dict(freq="weekly", interval=2, byday="MO")),
        ("every 3 weeks on mon", dict(freq="weekly", interval=3, byday="MO")),
        ("every other week on mon and fri", dict(freq="weekly", interval=2, byday="MO,FR")),
        ("every 3 weeks on mon and fri", dict(freq="weekly", interval=3, byday="MO,FR")),
        ("every 3 days", dict(freq="daily", interval=3)),
        ("every 2nd of the month", dict(freq="monthly", interval=1, bymonthday="2")),
        ("every 4th of the month", dict(freq="monthly", interval=1, bymonthday="4")),
        ("4th of every month", dict(freq="monthly", interval=1, bymonthday="4")),
        ("every month on the 4th", dict(freq="monthly", interval=1, bymonthday="4")),
        ("every month on the 4th day", dict(freq="monthly", interval=1, bymonthday="4")),
        ("the 4th of every other month", dict(freq="monthly", interval=2, bymonthday="4")),
        ("the 4th of every 3 months", dict(freq="monthly", interval=3, bymonthday="4")),
        ("every other month on the 4th", dict(freq="monthly", interval=2, bymonthday="4")),
        ("every 3 months on the 4th", dict(freq="monthly", interval=3, bymonthday="4")),
        ("the 4th of every 3rd month", dict(freq="monthly", interval=3, bymonthday="4")),
        ("every 3rd month on the 4th", dict(freq="monthly", interval=3, bymonthday="4")),
        ("every 4th and 10th of the month", dict(freq="monthly", interval=1, bymonthday="4,10")),
        ("every 4th and 10th of the month up to 7x", dict(freq="monthly", interval=1, bymonthday="4,10", count=7)),
        ("every first friday of the month", dict(freq="monthly", interval=1, byday="1FR")),
        ("monthly on fri", dict(freq="monthly", interval=1, byday="FR")),
        ("monthly on tue and fri", dict(freq="monthly", interval=1, byday="TU,FR")),
        ("monthly on the first and last instance of tue and fri",
         dict(freq="monthly", interval=1, byday="TU,FR", bysetpos="1,-1")),
        ("every last friday of the month", dict(freq="monthly", interval=1, byday="-1FR")),
        ("2nd to the last friday of each month", dict(freq="monthly", interval=1, byday="-2FR")),
        ("2nd and last fri of each month", dict(freq="monthly", interval=1, byday="2FR,-1FR")),
        ("2nd and 2nd to the last fri of each month", dict(freq="monthly", interval=1, byday="2FR,-2FR")),
        ("2nd and last fridays of each month", dict(freq="monthly", interval=1, byday="2FR,-1FR")),
        ("first day of each month", dict(freq="monthly", interval=1, bymonthday="1")),
        ("beginning of each month", dict(freq="monthly", interval=1, bymonthday="1")),
        ("begin of each month", dict(freq="monthly", interval=1, bymonthday="1")),
        ("start of each month", dict(freq="monthly", interval=1, bymonthday="1")),
        ("every month on the 1st day", dict(freq="monthly", interval=1, bymonthday="1")),
        ("every month at the beginning", dict(freq="monthly", interval=1, bymonthday="1")),
        ("every month at the begin", dict(freq="monthly", interval=1, bymonthday="1")),
        ("every month at the start", dict(freq="monthly", interval=1, bymonthday="1")),
        ("first of each month", dict(freq="monthly", interval=1, bymonthday="1")),
        ("last of each month", dict(freq="monthly", interval=1, bymonthday="-1")),
        ("end of each month", dict(freq="monthly", interval=1, bymonthday="-1")),
        ("2nd to the last of each month", dict(freq="monthly", interval=1, bymonthday="-2")),
        ("last day of each month", dict(freq="monthly", interval=1, bymonthday="-1")),
        ("each month at the end", dict(freq="monthly", interval=1, bymonthday="-1")),
        ("2nd friday of each month", dict(freq="monthly", interval=1, byday="2FR")),
        ("second friday of each month", dict(freq="monthly", interval=1, byday="2FR")),
        ("first friday of every month", dict(freq="monthly", interval=1, byday="1FR")),
        ("first friday of each month", dict(freq="monthly", interval=1, byday="1FR")),
        ("first friday of every other month", dict(freq="monthly", interval=2, byday="1FR")),
        ("first friday of every 3 months", dict(freq="monthly", interval=3, byday="1FR")),
        ("first friday of every 3rd month", dict(freq="monthly", interval=3, byday="1FR")),
        ("first and third friday of each month", dict(freq="monthly", interval=1, byday="1FR,3FR")),
        ("first, second, and third friday of each month", dict(freq="monthly", interval=1, byday="1FR,2FR,3FR")),
        ("first and third friday and second tuesday of each month",
         dict(freq="monthly", interval=1, byday="1FR,3FR,2TU")),
        ("yearly on the fourth thursday in november", dict(freq="yearly", interval=1, byday="4TH", bymonth="11")),
        ("every year on the fourth thursday in november", dict(freq="yearly", interval=1, byday="4TH", bymonth="11")),
        ("every fourth thursday in november", dict(freq="yearly", interval=1, byday="4TH", bymonth="11")),
        ("every other year on the fourth thursday in november",
         dict(freq="yearly", interval=2, byday="4TH", bymonth="11")),
        ("every 3 years on the fourth thursday in november",
         dict(freq="yearly", interval=3, byday="4TH", bymonth="11")),
        ("every 3rd year on the fourth thursday in november",
         dict(freq="yearly", interval=3, byday="4TH", bymonth="11")),
        ("once a year on december 25th", dict(freq="yearly", interval=1, bymonthday="25", bymonth="12")),
        ("every year on december 21st and 31st", dict(freq="yearly", interval=1, bymonthday="21,31", bymonth="12")),
        ("every year on december 31st", dict(freq="yearly", interval=1, bymonthday="31", bymonth="12")),
        ("every year on the 31st", dict(freq="yearly", interval=1, byyearday="31")),
        ("31st of every year", dict(freq="yearly", interval=1, byyearday="31")),
        ("31st day of every year", dict(freq="yearly", interval=1, byyearday="31")),
        ("every year on the 31st day", dict(freq="yearly", interval=1, byyearday="31")),
        ("every year on the day 31", dict(freq="yearly", interval=1, byyearday="31")),
        ("every july 4th", dict(freq="yearly", interval=1, bymonthday="4", bymonth="7")),
        ("every aug 30", dict(freq="yearly", interval=1, bymonthday="30", bymonth="8")),
        ("every aug 20 and 30", dict(freq="yearly", interval=1, bymonthday="20,30", bymonth="8")),
        ("every aug on day 20 and 30", dict(freq="yearly", interval=1, bymonthday="20,30", bymonth="8")),
        ("every year in week 12", dict(freq="yearly", interval=1, byweekno="12")),
        ("every 3 years on Fri in week 12", dict(freq="yearly", interval=3, byday="FR", byweekno="12")),
        ("every Fri in week 12", dict(freq="yearly", interval=1, byday="FR", byweekno="12")),
        ("every Fri in week 12 and 14", dict(freq="yearly", interval=1, byday="FR", byweekno="12,14")),
        ("every 20th and 30th of aug", dict(freq="yearly", interval=1, bymonthday="20,30", bymonth="8")),
        ("every other hour", dict(freq="hourly", interval=2)),
        ("every 2 hours", dict(freq="hourly", interval=2)),
        ("every 2 hours twice", dict(freq="hourly", interval=2, count=2)),
        ("daily at 12am", dict(freq="daily", interval=1, byhour="0", byminute="0")),
        ("daily at 12a", dict(freq="daily", interval=1, byhour="0", byminute="0")),
        ("daily at 3am", dict(freq="daily", interval=1, byhour="3", byminute="0")),
        ("daily at 3am 10x", dict(freq="daily", interval=1, byhour="3", byminute="0", count=10)),
        ("daily at 3:00am", dict(freq="daily", interval=1, byhour="3", byminute="0")),
        ("daily at 3:01am", dict(freq="daily", interval=1, byhour="3", byminute="1")),
        ("daily at 12pm", dict(freq="daily", interval=1, byhour="12", byminute="0")),
        ("daily at 12p", dict(freq="daily", interval=1, byhour="12", byminute="0")),
        ("daily at 3pm", dict(freq="daily", interval=1, byhour="15", byminute="0")),
        ("daily at 3 pm", dict(freq="daily", interval=1, byhour="15", byminute="0")),
        ("daily at 3p", dict(freq="daily", interval=1, byhour="15", byminute="0")),
        ("daily at 3:00pm", dict(freq="daily", interval=1, byhour="15", byminute="0")),
        ("daily at 3:01pm", dict(freq="daily", interval=1, byhour="15", byminute="1")),
        ("at 10 am on 15th of every month",
         dict(freq="monthly", interval=1, byhour="10", byminute="0", bymonthday="15")),
        ("every other saturdays through tuesdays", dict(freq="weekly", interval=2, byday="MO,TU,SA,SU")),
        ("each week on saturday thru tuesday", dict(freq="weekly", interval=1, byday="SA,SU,MO,TU")),
        ("each week on tuesday-saturday", dict(freq="weekly", interval=1, byday="TU,WE,TH,FR,SA")),
        ("each week on tuesday-tue", dict(freq="weekly", interval=1, byday="TU")),
        ("tuesdays-tue", dict(freq="weekly", interval=1, byday="TU")),
        ("saturdays through tuesdays", dict(freq="weekly", interval=1, byday="MO,TU,SA,SU")),
        ("on weekdays", dict(freq="weekly", interval=1, byday="MO,TU,WE,TH,FR")),
        ("once a year on the fourth thursday in november", dict(freq="yearly", interval=1, bymonth="11", byday="4TH")),
        ("wednesdays at 9 o'clock", dict(freq="weekly", interval=1, byday="WE", byhour="9", byminute="0")),
        ("fridays at 11am", dict(freq="weekly", interval=1, byday="FR", byhour="11", byminute="0")),
        ("fridays twice", dict(freq="weekly", interval=1, byday="FR", count=2)),
        ("fridays 3x", dict(freq="weekly", interval=1, byday="FR", count=3)),
        ("every other friday for 5 times", dict(freq="weekly", interval=2, byday="FR", count=5)),
        ("monthly on the first and last instance of wed and fri",
         dict(freq="monthly", interval=1, byday="WE,FR", bysetpos="1,-1")),
        ("every Tue and Fri in week 14", dict(freq="yearly", interval=1, byday="TU,FR", byweekno="14")),
        ("every year on Dec 25", dict(freq="yearly", interval=1, bymonth="12", bymonthday="25")),
    ]

    def test_the_rules(self):
        for text, fields in self.EXAMPLES:
            self.assertEqual(rfc(parse_rule(text)), expected(**fields), text)

    def test_where_plina_reads_it_differently(self):
        # The 4th day of the week is Thursday (ISO 8601), recurrent counted from Sunday.
        self.assertEqual(rfc(parse_rule("every week on the 4th day")), expected(freq="weekly", interval=1, byday="TH"))
        # 24-hour times: recurrent guessed the afternoon.
        self.assertEqual(rfc(parse_rule("tuesdays and thursdays at 3:15")),
                         expected(freq="weekly", interval=1, byday="TU,TH", byhour="3", byminute="15"))

    def test_starting_until_and_for(self):
        self.assertEqual(days("daily starting march 3rd", 2), ["03.03.2027", "04.03.2027"])
        self.assertEqual(days("starting in april, daily until march")[::len(days("starting in april, daily until march")) - 1],
                         ["01.04.2027", "29.02.2028"])  # until March: the end of February
        self.assertEqual(days("daily starting march 3rd until april 5th")[-1], "05.04.2027")
        self.assertEqual(days("daily starting march 3rd for 8 times")[-1], "10.03.2027")
        self.assertEqual(days("starting tomorrow on weekends", 2), ["10.10.2026", "11.10.2026"])
        self.assertEqual(days("every wed until november"), ["07.10.2026", "14.10.2026", "21.10.2026", "28.10.2026"])
        self.assertEqual(days("every 4th of the month starting next tuesday for 3 occurrences"),
                         ["04.11.2026", "04.12.2026", "04.01.2027"])
        self.assertEqual(days("starting next tuesday on the 4th of each month", 1), ["04.11.2026"])
        self.assertEqual(days("starting next tuesday the 4th of each month for 3 occurrences")[-1], "04.01.2027")
        thursdays = days("mondays and thursdays from jan 1 to march 25th")
        self.assertEqual((thursdays[0], thursdays[-1]), ("04.01.2027", "25.03.2027"))
        self.assertEqual(days("mondays and thursdays starting jan 1 for 6 times")[-1], "21.01.2027")
        self.assertEqual(days("every thursday for the next three weeks"), ["08.10.2026", "15.10.2026", "22.10.2026"])
        self.assertEqual(days("every mon and fri for the next month")[-1], "02.11.2026")
        self.assertEqual(len(days("every sat for 2 months")), 8)  # until 5 December
        self.assertEqual(days("every sat for up to 2 months")[-1], "28.11.2026")
        fridays = days("every other fri for the next year")
        self.assertEqual((len(fridays), fridays[-1]), (26, "24.09.2027"))
        self.assertEqual(days("each thurs until next month"), ["08.10.2026", "15.10.2026", "22.10.2026", "29.10.2026"])
        self.assertEqual(days("fridays starting in may for 10 occurrences")[::9], ["07.05.2027", "09.07.2027"])
        self.assertEqual(len(days("tuesdays for the next six weeks")), 6)
        self.assertEqual(days("every Mon-Wed for the next 2 months", 3), ["06.10.2026", "07.10.2026", "12.10.2026"])
        self.assertEqual(days("every 3 fridays from november until february"),
                         ["06.11.2026", "27.11.2026", "18.12.2026", "08.01.2027", "29.01.2027"])
        # A series in the past, from its own start.
        fourths = days("every fourth of the month from jan 1 2010 to dec 25th 2020",
                       start=datetime(2009, 1, 1, tzinfo=BERLIN))
        self.assertEqual((len(fourths), fourths[0], fourths[-1]), (132, "04.01.2010", "04.12.2020"))

    def test_except(self):
        self.assertEqual(days("daily except for tomorrow", 2), ["07.10.2026", "08.10.2026"])
        self.assertEqual(days("daily except on weekends", 5)[-2:], ["09.10.2026", "12.10.2026"])
        self.assertFalse([day for day in days("daily except in may", 400) if day.endswith(".05.2027")])
        self.assertTrue([day for day in days("daily except in may 2027", 1000) if day.endswith(".05.2028")])
        self.assertFalse([day for day in days("daily except in may 2027", 400) if day.endswith(".05.2027")])
        weekends = days("every 4 weekends except in july and sept", 40)
        self.assertFalse([day for day in weekends if day[3:5] in ("07", "09")])
        self.assertEqual(days("daily starting march 3rd except on march 6th and march 8th", 5),
                         ["03.03.2027", "04.03.2027", "05.03.2027", "07.03.2027", "09.03.2027"])
        wednesdays = days("every wed from november until june except in december and mar and may")
        self.assertEqual((wednesdays[0], wednesdays[-1]), ("04.11.2026", "28.04.2027"))
        self.assertFalse([day for day in wednesdays if day[3:5] in ("12", "03", "05")])
        for text in ("every monday except for the 2nd monday in March", "every monday except each 2nd monday in March"):
            march = [day for day in days(text, 30) if day.endswith(".03.2027")]
            self.assertEqual(march, ["01.03.2027", "15.03.2027", "22.03.2027", "29.03.2027"], text)
        # A date without a year: every year.
        summer = days("daily except on June 23rd and July 4th", 1100)
        self.assertNotIn("23.06.2027", summer)
        self.assertNotIn("04.07.2028", summer)
        self.assertIn("24.06.2027", summer)
        self.assertNotIn("06.10.2026", days("every 8 hours except tomorrow", 10))


class DescriptionsTest(SimpleTestCase):
    def test_a_normalized_description(self):
        for text, description in [
            ("every tuesday 20:00", "every Tuesday at 20:00"),
            ("every 4 weeks on tuesday 14:00", "every 4 weeks on Tuesday at 14:00"),
            ("every first sunday each month at 12:30", "every first Sunday of the month at 12:30"),
            ("every weekday at 8:00", "every weekday at 08:00"),
            ("every month on the 15th", "every month on the 15th"),
            ("every day", "every day"),
            ("every tuesday evening", "every Tuesday at 18:00"),
            ("every weekday at 9:00 and 14:30", "every weekday at 09:00 and 14:30"),
            ("first, second, and third friday of each month", "every first, second and third Friday of the month"),
            ("monthly on the first and last instance of tue and fri", "every month on the first and last Tuesday or Friday"),
            ("the last workday of the month", "every month on the last weekday"),
            ("every fourth thursday in november", "every fourth Thursday in November"),
            ("every year on december 21st and 31st", "every year on December 21st and 31st"),
            ("every other weekend", "every 2 weeks on weekends"),
            ("every 4 weekends except in july and sept", "every 4 weeks on weekends except in July and September"),
            ("every day except saturdays and sundays", "every day except weekends"),
            ("every thursday for the next three weeks", "every Thursday for 3 weeks"),
            ("mondays and thursdays from jan 1 to march 25th",
             "every Monday and Thursday starting January 1st until March 25th"),
            ("fridays twice", "every Friday, 2 times"),
            ("every monday except each 2nd monday in march", "every Monday except the second Monday in March"),
            ("daily except tomorrow", "every day except tomorrow"),
        ]:
            self.assertEqual(describe(parse_rule(text)), description, text)


class NotUnderstoodTest(SimpleTestCase):
    def test_says_which_words_are_not_understood_with_examples(self):
        with self.assertRaisesMessage(RecurrenceError, "“fortnightly-ish”"):
            parse_rule("every tuesday fortnightly-ish")
        with self.assertRaisesMessage(RecurrenceError, "every tuesday at 20:00"):
            parse_rule("sometimes")
        with self.assertRaisesMessage(RecurrenceError, "“holidays”"):
            parse_rule("every day except holidays")
        with self.assertRaisesMessage(RecurrenceError, "“tomorrow”"):
            parse_rule("tomorrow")  # once is not a repetition

    def test_impossible_values(self):
        for text, part in (("every day at 25:00", "25:00"), ("every month on the 32nd", "32nd"),
                           ("every 8th day of the week", "8th"), ("every february 30th", "February has no 30th"),
                           ("every 6th friday of the month", "6th"), ("every hour at 9:00", "every hour"),
                           ("every year in week 54", "week 54"), ("starting 31.02. every day", "31.02."), ("", "")):
            with self.assertRaises(RecurrenceError, msg=text) as raised:
                parse_rule(text)
            self.assertIn(part, str(raised.exception), text)

    def test_more_often_than_hourly_is_refused(self):
        for text in ("every 5 minutes", "every 30 seconds", "every 20 min", "every second", "every minute"):
            with self.assertRaisesMessage(RecurrenceError, "at most every hour", msg=text):
                parse_rule(text)

    def test_how_often_needs_which_days(self):
        with self.assertRaisesMessage(RecurrenceError, "“twice a week”"):
            parse_rule("twice a week")
        with self.assertRaisesMessage(RecurrenceError, "“3 times a month”"):
            parse_rule("3 times a month")
