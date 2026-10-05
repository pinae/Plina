"""Recurrence rules in plain language (README: Recurring tasks), for
recurring tasks and time bucket types: "every tuesday 20:00", "every 4 weeks
on tuesday 14:00", "every first sunday each month at 12:30", …

The grammar understands what the ``recurrent`` library understood, which
Plina used before (tests/test_recurrence_rules.py walks through its
examples): intervals, weekdays and ranges of them, days of the month and
year, nth weekdays, week numbers, "starting …", "until …", "for the next 3
weeks", "10 times", "except …". It names the words it does not understand.
Where it differs from ``recurrent``: times are 24-hour unless am/pm is said
("at 3:15" is 03:15), a rule without a time starts the day at 00:00,
"morning", "afternoon", "evening" and "night" mean 08:00, 14:00, 18:00 and
21:00, "except on December 24th" skips it every year, and repeating more
often than hourly is refused (a bucket or task every 5 minutes is no plan).

A rule becomes a series of dateutil ``rrule``s counted from an *anchor*: the
series' start, so "every 4 weeks" keeps its rhythm and "for the next 3
weeks" ends. Rules mean wall-clock time in the user's zone: 20:00 stays
20:00 across daylight saving time.
"""
from __future__ import annotations

import calendar
import difflib
import heapq
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, tzinfo
from functools import lru_cache
from typing import Iterator, List, Optional, Tuple

from dateutil import rrule
from dateutil.relativedelta import relativedelta
from django.utils import timezone

EXAMPLES = "“every tuesday at 20:00”, “every 4 weeks on tuesday 14:00” or “every first sunday of the month at 12:30”"


class RecurrenceError(ValueError):
    """The text is not a recognizable recurrence rule; the message says why."""


# --- Words -------------------------------------------------------------------

_WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_WEEKDAYS = {}
for _index, _forms in enumerate([("monday", "mon"), ("tuesday", "tue", "tues"), ("wednesday", "wed"),
                                 ("thursday", "thu", "thur", "thurs"), ("friday", "fri"), ("saturday", "sat"),
                                 ("sunday", "sun")]):
    for _form in _forms:
        _WEEKDAYS[_form] = _WEEKDAYS[_form + "s"] = _index
_WORKDAYS, _WEEKEND = (0, 1, 2, 3, 4), (5, 6)
_GROUPS = {"weekday": _WORKDAYS, "workday": _WORKDAYS, "weekend": _WEEKEND}
_GROUPS.update({name + "s": days for name, days in list(_GROUPS.items())})
_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                "October", "November", "December"]
_MONTHS = {}
for _index, _name in enumerate(_MONTH_NAMES, start=1):
    _MONTHS[_name.lower()] = _MONTHS[_name[:3].lower()] = _index
_MONTHS["sept"] = 9
_MONTH_LENGTHS = {month: calendar.monthrange(2000, month)[1] for month in range(1, 13)}  # a leap year
# Misspellings are forgiven for these: "wednsday".
_FUZZY = [name.lower() for name in _WEEKDAY_NAMES + _MONTH_NAMES]
_FUZZY += [name + "s" for name in _FUZZY[:7]]
_ORDINAL_WORDS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7,
                  "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11, "twelfth": 12, "last": -1}
_ORDINAL_NAMES = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", -1: "last"}
_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
                 "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}
_UNITS = {"hour": rrule.HOURLY, "day": rrule.DAILY, "week": rrule.WEEKLY, "month": rrule.MONTHLY,
          "year": rrule.YEARLY}
_UNITS.update({name + "s": freq for name, freq in list(_UNITS.items())})
_UNIT_NAMES = {freq: name for name, freq in _UNITS.items() if not name.endswith("s")}
_TOO_OFTEN = {"minute", "minutes", "min", "mins", "second", "seconds", "sec", "secs"}
_ADVERBS = {"hourly": (rrule.HOURLY, 1), "daily": (rrule.DAILY, 1), "weekly": (rrule.WEEKLY, 1),
            "fortnightly": (rrule.WEEKLY, 2), "biweekly": (rrule.WEEKLY, 2), "monthly": (rrule.MONTHLY, 1),
            "quarterly": (rrule.MONTHLY, 3), "yearly": (rrule.YEARLY, 1), "annually": (rrule.YEARLY, 1)}
_DAYTIMES = {"noon": (12, 0), "midday": (12, 0), "midnight": (0, 0), "morning": (8, 0), "afternoon": (14, 0),
             "evening": (18, 0), "night": (21, 0)}
_DAYTIMES.update({name + "s": hours for name, hours in list(_DAYTIMES.items())})
_FILLER = {"every", "each", "on", "the", "of", "and", "or", "in", "a", "an", "per", "at"}
_COUNTED = {"x", "times", "time", "occurrences", "occurrence"}
_START_WORDS = {"starting", "commencing", "beginning", "begin", "start", "from"}
_UNTIL_WORDS = {"until", "till", "til", "untill", "ending", "through", "thru", "to"}
_RANGE_WORDS = {"thru", "through", "to", "till", "until"}
_PERIODS = {"day", "days", "week", "weeks", "month", "months", "year", "years"}

_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})(am|pm|a|p)?$")
_HOUR_MERIDIEM = re.compile(r"^(\d{1,2})(?:[.:](\d{2}))?(am|pm|a|p)$")
_DOTTED_TIME = re.compile(r"^(\d{1,2})\.(\d{2})\.?$")
_NUMERIC_ORDINAL = re.compile(r"^(\d{1,3})(st|nd|rd|th)$")
_ISO_DATE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_DOTTED_DATE = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?$")
_TIMES_X = re.compile(r"^(\d+)x$")
_WEEKDAY_PATTERN = "|".join(sorted(_WEEKDAYS, key=len, reverse=True))


def _weekday(token: Optional[str]) -> Optional[int]:
    return _WEEKDAYS.get(token) if token else None


def _month(token: Optional[str]) -> Optional[int]:
    return _MONTHS.get(token) if token else None


def _number(token: Optional[str]) -> Optional[int]:
    if token is None:
        return None
    if token.isdigit():
        return int(token)
    return _NUMBER_WORDS.get(token)


def _ordinal(token: Optional[str]) -> Optional[int]:
    if token is None:
        return None
    if token in _ORDINAL_WORDS:
        return _ORDINAL_WORDS[token]
    match = _NUMERIC_ORDINAL.match(token)
    return int(match.group(1)) if match else None


def _day_of_month(token: Optional[str]) -> Optional[int]:
    """A day of the month after a month name: "3rd", "3" (not "last")."""
    value = _ordinal(token) if _ordinal(token) is not None else (int(token) if token and token.isdigit() else None)
    return value if value is not None and 1 <= value <= 31 else None


def _year(token: Optional[str]) -> Optional[int]:
    return int(token) if token and re.fullmatch(r"\d{4}", token) else None


def _suffixed(number: int) -> str:
    suffix = "th" if 11 <= number % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"


def _ordinal_name(number: int) -> str:
    if number in _ORDINAL_NAMES:
        return _ORDINAL_NAMES[number]
    if number < 0:
        return f"{_ordinal_name(-number)} to last"
    return _suffixed(number)


def _day_name(day: int) -> str:
    if day == -1:
        return "last day"
    if day < 0:
        return f"{_ordinal_name(-day)} to last day"
    return _suffixed(day)


def _join(items, last: str = "and") -> str:
    """"a", "a and b", "a, b and c"."""
    items = list(items)
    return ", ".join(items[:-1]) + f" {last} " + items[-1] if len(items) > 1 else "".join(items)


def _days_name(days, last: str = "and", plural: bool = False) -> str:
    """Weekdays by name, or the group they make up: "weekday"."""
    ordered = sorted(set(days))
    group = {_WORKDAYS: "weekday", _WEEKEND: "weekend", tuple(range(7)): "day"}.get(tuple(ordered))
    if group:
        return group + ("s" if plural else "")
    return _join((_WEEKDAY_NAMES[day] + ("s" if plural else "") for day in dict.fromkeys(days)), last)


def _nth_names(weekdays) -> List[str]:
    """"first, second and third Friday", "last Sunday", by weekday."""
    by_day = {}
    for day, nth in weekdays:
        if nth is not None:
            by_day.setdefault(day, []).append(nth)
    return [f"{_join(_ordinal_name(nth) for nth in nths)} {_WEEKDAY_NAMES[day]}" for day, nths in by_day.items()]


def _valid_date(year: Optional[int], month: int, day: int, raw: str) -> None:
    if not 1 <= day <= (calendar.monthrange(year, month)[1] if year else _MONTH_LENGTHS[month]):
        raise RecurrenceError(f"“{raw}” is not a date.")


def _nth_weekday(year: int, month: int, weekday: int, nth: int) -> Optional[date]:
    days = [day for day in range(1, calendar.monthrange(year, month)[1] + 1)
            if date(year, month, day).weekday() == weekday]
    try:
        return date(year, month, days[nth - 1 if nth > 0 else nth])
    except IndexError:
        return None


def _is_monthday(day: date, number: int) -> bool:
    return day.day == (number if number > 0 else calendar.monthrange(day.year, day.month)[1] + 1 + number)


def _is_weekday(day: date, weekday: int, nth: Optional[int]) -> bool:
    if day.weekday() != weekday:
        return False
    if nth is None:
        return True
    if nth > 0:
        return (day.day - 1) // 7 + 1 == nth
    return -((calendar.monthrange(day.year, day.month)[1] - day.day) // 7 + 1) == nth


# --- Rules -------------------------------------------------------------------

@dataclass(frozen=True)
class DateSpec:
    """A date in “starting …”, “until …” or “except …” ("march 3rd", "next
    tuesday", "for the next 3 weeks"), resolved against the series' start."""
    kind: str  # date, month, today, tomorrow, weekday, next, after, nth
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None
    weekday: Optional[int] = None
    nth: Optional[int] = None
    unit: Optional[str] = None
    amount: int = 0
    strict: bool = False

    def resolve(self, reference: date) -> date:
        if self.kind == "today":
            return reference
        if self.kind == "tomorrow":
            return reference + timedelta(days=1)
        if self.kind == "weekday":
            ahead = (self.weekday - reference.weekday()) % 7
            return reference + timedelta(days=ahead or (7 if self.strict else 0))
        if self.kind == "next":
            if self.unit == "week":
                return reference + timedelta(days=7 - reference.weekday())
            if self.unit == "month":
                return reference.replace(day=1) + relativedelta(months=1)
            return date(reference.year + 1, 1, 1)
        if self.kind == "after":
            return reference + relativedelta(**{self.unit + "s": self.amount})
        if self.kind == "month":
            year = self.year or (reference.year if self.month >= reference.month else reference.year + 1)
            return date(year, self.month, 1)
        for year in [self.year] if self.year else range(reference.year, reference.year + 9):
            if self.kind == "nth":
                found = _nth_weekday(year, self.month, self.weekday, self.nth)
            else:
                found = date(year, self.month, self.day) if self.day <= calendar.monthrange(year, self.month)[1] \
                    else None
            if found is not None and (self.year or found >= reference):
                return found
        return reference  # e.g. a fifth Monday that does not come: treat as now

    @property
    def inclusive(self) -> bool:
        """As an end: the named day still counts ("until march 25th"), unlike
        "until june", "until next month" and "for the next 3 weeks"."""
        return self.kind not in ("month", "next", "after")

    @property
    def label(self) -> str:
        year = f" {self.year}" if self.year else ""
        if self.kind in ("today", "tomorrow"):
            return self.kind
        if self.kind == "weekday":
            return ("next " if self.strict else "") + _WEEKDAY_NAMES[self.weekday]
        if self.kind == "next":
            return f"next {self.unit}"
        if self.kind == "after":
            return f"{self.amount} {self.unit}{'s' if self.amount != 1 else ''}"
        if self.kind == "month":
            return _MONTH_NAMES[self.month - 1] + year
        if self.kind == "nth":
            return f"the {_ordinal_name(self.nth)} {_WEEKDAY_NAMES[self.weekday]} in {_MONTH_NAMES[self.month - 1]}{year}"
        return f"{_MONTH_NAMES[self.month - 1]} {_suffixed(self.day)}{year}"


@dataclass(frozen=True)
class Exclusion:
    """What “except …” leaves out: a date ("tomorrow"), or every day that
    matches ("weekends", "in may", "december 24th", "the 2nd monday in march")."""
    weekdays: Tuple[Tuple[int, Optional[int]], ...] = ()
    monthdays: Tuple[int, ...] = ()
    months: Tuple[int, ...] = ()
    year: Optional[int] = None
    on: Optional[DateSpec] = None

    def matches(self, day: date, resolved: Optional[date]) -> bool:
        if self.on is not None:
            return day == resolved
        if self.year is not None and day.year != self.year:
            return False
        if self.months and day.month not in self.months:
            return False
        if self.monthdays and not any(_is_monthday(day, number) for number in self.monthdays):
            return False
        return not self.weekdays or any(_is_weekday(day, weekday, nth) for weekday, nth in self.weekdays)

    @property
    def label(self) -> str:
        if self.on is not None:
            return self.on.label
        months = _join(_MONTH_NAMES[month - 1] for month in self.months) + (f" {self.year}" if self.year else "")
        if self.monthdays and self.months:
            return f"{months} {_join(_day_name(day) for day in self.monthdays)}"
        parts = []
        plain = [day for day, nth in self.weekdays if nth is None]
        if plain:
            parts.append(_days_name(plain, plural=True))
        parts += [f"the {name}" for name in _nth_names(self.weekdays)]
        if self.monthdays:
            parts.append("the " + _join(_day_name(day) for day in self.monthdays))
        text = _join(parts)
        return f"{text} in {months}".strip() if self.months else text


@dataclass(frozen=True)
class Rule:
    """A parsed rule. ``weekdays``: (weekday 0=Monday, nth or None);
    ``times``: (hour, minute) — none means 00:00 (on the hour if hourly)."""
    freq: int
    interval: int = 1
    weekdays: Tuple[Tuple[int, Optional[int]], ...] = ()
    monthdays: Tuple[int, ...] = ()
    yeardays: Tuple[int, ...] = ()
    weeknos: Tuple[int, ...] = ()
    months: Tuple[int, ...] = ()
    setpos: Tuple[int, ...] = ()
    times: Tuple[Tuple[int, int], ...] = ()
    count: Optional[int] = None
    start: Optional[DateSpec] = None
    until: Optional[DateSpec] = None
    exclusions: Tuple[Exclusion, ...] = ()
    text: str = ""

    @property
    def has_time(self) -> bool:
        return bool(self.times)

    def series(self, anchor: datetime, earliest: Optional[datetime] = None) -> Series:
        """The occurrences counted from ``anchor`` (naive, local); asked for
        from ``earliest`` on, an open-ended rule reaches back before it."""
        return Series(self, anchor, earliest)


class Series:
    """A rule's occurrences from an anchor, as naive local datetimes."""

    def __init__(self, rule: Rule, anchor: datetime, earliest: Optional[datetime] = None):
        self.rule = rule
        first_day = anchor.date()
        start_day = rule.start.resolve(first_day) if rule.start else None
        dtstart = datetime.combine(start_day, time()) if start_day else anchor
        self.until = None
        if rule.until is not None:
            end_day = rule.until.resolve(start_day or first_day)
            self.until = datetime.combine(end_day + timedelta(days=1 if rule.until.inclusive else 0), time())
        self.excluded = [(exclusion, exclusion.on.resolve(first_day) if exclusion.on else None)
                         for exclusion in rule.exclusions]
        options = self._options(dtstart)
        #: Nothing before it (the anchor), when the counting starts earlier.
        self.floor = None
        if rule.interval > 1:
            # "every 4 weeks on tuesday", made on a Wednesday: the coming
            # Tuesday first, then every 4 weeks — dateutil would count the
            # anchor's week and skip to 4 weeks later.
            firsts = [rrule.rrule(dtstart=dtstart, **{**options, "interval": 1}, **times).after(dtstart, inc=True)
                      for times in self._times()]
            firsts = [first for first in firsts if first is not None]
            if firsts:
                self.floor, dtstart = dtstart, _period_start(min(firsts), rule.freq)
        if earliest is not None and earliest < (self.floor or dtstart) and rule.count is None and rule.start is None:
            dtstart = _earlier(dtstart, earliest, rule.freq, rule.interval)
            self.floor = None
        if self.until is not None:
            options["until"] = self.until - timedelta(seconds=1)
        self.rrules = [rrule.rrule(dtstart=dtstart, **options, **times) for times in self._times()]

    def _options(self, dtstart: datetime) -> dict:
        rule = self.rule
        options = {"freq": rule.freq, "interval": rule.interval}
        if rule.weekdays:
            options["byweekday"] = [rrule.weekday(day, nth) for day, nth in rule.weekdays]
        if rule.monthdays:
            options["bymonthday"] = rule.monthdays
        if rule.yeardays:
            options["byyearday"] = rule.yeardays
        if rule.weeknos:
            options["byweekno"] = rule.weeknos
        if rule.months:
            options["bymonth"] = rule.months
        if rule.setpos:
            options["bysetpos"] = rule.setpos
        # What dateutil would take from dtstart, made explicit: an earlier
        # dtstart (see _earlier) must not change it.
        days_given = rule.weekdays or rule.monthdays or rule.yeardays or rule.weeknos
        if rule.freq == rrule.WEEKLY and not days_given:
            options["byweekday"] = dtstart.weekday()
        elif rule.freq == rrule.MONTHLY and not days_given:
            options["bymonthday"] = dtstart.day
        elif rule.freq == rrule.YEARLY and not days_given and not rule.months:
            options.update(bymonth=dtstart.month, bymonthday=dtstart.day)
        return options

    def _times(self) -> List[dict]:
        if not self.rule.times:
            if self.rule.freq == rrule.HOURLY:
                return [{"byminute": 0, "bysecond": 0}]
            return [{"byhour": 0, "byminute": 0, "bysecond": 0}]
        hours_by_minute = {}
        for hour, minute in self.rule.times:
            hours_by_minute.setdefault(minute, []).append(hour)
        return [{"byhour": hours, "byminute": minute, "bysecond": 0} for minute, hours in hours_by_minute.items()]

    def _iterate(self, lower: datetime, upper: datetime) -> Iterator[datetime]:
        counting = self.rule.count is not None  # counts from the start, so from there
        sources = [iter(each) if counting else each.xafter(lower, inc=True) for each in self.rrules]
        previous, seen = None, 0
        for moment in heapq.merge(*sources):
            if moment > upper:
                return
            if moment == previous or self.floor is not None and moment < self.floor:
                continue
            previous = moment
            if any(exclusion.matches(moment.date(), day) for exclusion, day in self.excluded):
                continue
            seen += 1
            if counting and seen > self.rule.count:
                return
            if moment >= lower:
                yield moment

    def between(self, start: datetime, end: datetime) -> List[datetime]:
        """The occurrences from ``start`` to ``end``, both included."""
        return list(self._iterate(start, end))

    def after(self, moment: datetime) -> Optional[datetime]:
        """The first occurrence strictly after ``moment`` (None: no more)."""
        return next(self._iterate(moment + timedelta(seconds=1), moment + relativedelta(years=50)), None)


def _period_start(moment: datetime, freq: int) -> datetime:
    """The start of the year, month, week (from Monday), day or hour of ``moment``."""
    if freq == rrule.HOURLY:
        return moment.replace(minute=0)
    day = datetime.combine(moment.date(), time())
    if freq == rrule.WEEKLY:
        return day - timedelta(days=day.weekday())
    if freq == rrule.MONTHLY:
        return day.replace(day=1)
    if freq == rrule.YEARLY:
        return day.replace(month=1, day=1)
    return day


def _earlier(dtstart: datetime, earliest: datetime, freq: int, interval: int) -> datetime:
    """``dtstart`` moved back by whole intervals to before ``earliest``, so the
    rhythm ("every 2 weeks") stays the anchor's."""
    step = {rrule.YEARLY: relativedelta(years=interval), rrule.MONTHLY: relativedelta(months=interval),
            rrule.WEEKLY: relativedelta(weeks=interval), rrule.DAILY: relativedelta(days=interval),
            rrule.HOURLY: relativedelta(hours=interval)}[freq]
    days = {rrule.YEARLY: 366, rrule.MONTHLY: 31, rrule.WEEKLY: 7, rrule.DAILY: 1, rrule.HOURLY: 1 / 24}[freq]
    moment = dtstart - step * max(0, int((dtstart - earliest).days / (days * interval)) - 1)
    while moment > earliest:
        moment -= step
    return moment


# --- Parsing -----------------------------------------------------------------

def _tokens(text: str) -> List[str]:
    text = text.lower().replace("’", "'").replace("&", " and ")
    text = re.sub(r"\b([ap])\.m\.", r"\1m", text)
    text = re.sub(r"[,;()]", " ", text)
    text = re.sub(r"\beveryday\b", "every day", text)
    text = re.sub(r"\b(?:business|working|work) ?days?\b", "workdays", text)
    text = re.sub(r"\bweek days?\b", "weekdays", text)
    text = re.sub(r"\bo'? ?clock\b", "oclock", text)
    text = re.sub(rf"\b({_WEEKDAY_PATTERN})\s*-\s*({_WEEKDAY_PATTERN})\b", r"\1 thru \2", text)
    return [token[:-1] if re.fullmatch(r"[a-z']+\.", token) else token for token in text.split()]


class _Parser:
    def __init__(self, text: str):
        self.text = text.strip()
        self.tokens = _tokens(text)
        self.i = 0
        self.interval: Optional[Tuple[int, int]] = None
        self.units = set()
        self.weekdays: List[Tuple[int, Optional[int]]] = []
        #: (number, as typed): days of the month — or of the year, if yearly
        #: without a month ("every year on the 31st").
        self.days: List[Tuple[int, str]] = []
        #: "the 4th day": of the week if weekly, else like ``days``.
        self.nth_days: List[Tuple[int, str]] = []
        self.weeknos: List[int] = []
        self.months: List[int] = []
        self.setpos: List[int] = []
        self.times: List[Tuple[int, int]] = []
        self.count: Optional[int] = None
        self.start: Optional[DateSpec] = None
        self.until: Optional[DateSpec] = None
        self.exclusions: List[Exclusion] = []
        self.unknown: List[str] = []
        #: "every 2nd friday": (2, indexes into weekdays) — every other
        #: Friday, unless a month is mentioned ("… of the month").
        self.every_nth: Optional[Tuple[int, range]] = None
        #: The last time without am/pm, for "at 7 in the evening": (index, end).
        self.bare_time: Optional[Tuple[int, int]] = None

    def at(self, j: int) -> Optional[str]:
        return self.tokens[j] if 0 <= j < len(self.tokens) else None

    def peek(self, offset: int = 0) -> Optional[str]:
        return self.at(self.i + offset)

    def parse(self) -> Rule:
        if not self.tokens:
            raise RecurrenceError(f"Enter when it repeats, e.g. {EXAMPLES}.")
        while self.i < len(self.tokens):
            self.step()
        if self.unknown:
            raise RecurrenceError(f"Plina does not understand “{' '.join(self.unknown)}” in “{self.text}”. "
                                  f"Try e.g. {EXAMPLES}.")
        return self.build()

    # One phrase at a time.

    def step(self) -> None:
        token, following = self.peek(), self.peek(1)
        if token == "except":
            self.i += 1
            self.exclusion_clause()
        elif token == "from" and self.weekday_range_at(self.i + 1):
            self.i += 1  # "from monday to friday": the days, not dates
        elif token in _START_WORDS and self.date_at(self.i + 1, weekday=True):
            self.start, self.i = self.date_at(self.i + 1, weekday=True)
        elif token in ("beginning", "begin", "start") and following in (None, "of", "and", "at"):
            self.days.append((1, token))  # "beginning of each month", "every month at the start"
            self.i += 1
        elif token == "end" and following in (None, "of", "and", "at"):
            self.days.append((-1, token))
            self.i += 1
        elif token == "up" and following == "to" and (self.count_at(self.i + 2) or self.date_at(self.i + 2)):
            if self.count_at(self.i + 2):
                self.count, self.i = self.count_at(self.i + 2)
            else:
                self.until, self.i = self.date_at(self.i + 2)
        elif token in _UNTIL_WORDS and self.date_at(self.i + 1, weekday=True):
            self.until, self.i = self.date_at(self.i + 1, weekday=True)
        elif token == "for":
            self.for_clause()
        elif self.count_at(self.i):
            first = self.i
            self.count, self.i = self.count_at(self.i)
            if self.peek() in ("a", "per", "each", "every"):  # "twice a week"
                raise RecurrenceError(f"Say on which days instead of “{' '.join(self.tokens[first:self.i + 2])}”, "
                                      "e.g. “every monday and thursday”.")
        elif token == "once" and following in ("a", "an", "per", "every", "each"):
            self.i += 1
        elif token in ("every", "each"):
            self.i += 1
            self.after_every()
        elif token in ("at", "from") and self.time_at(self.i + 1, after_at=True):
            self.i += 1
            self.time_list(after_at=True)
        elif self.time_at(self.i, after_at=False):
            self.time_list(after_at=False)
        elif token in _DAYTIMES:
            self.daytime(token)
        elif token in _ADVERBS:
            freq, interval = _ADVERBS[token]
            self.set_interval(interval, freq, token) if interval > 1 else self.units.add(freq)
            self.i += 1
        elif token in ("fortnight", "fortnights"):
            self.set_interval(2, rrule.WEEKLY, token)
            self.i += 1
        elif token in ("day", "days") and _number(following) is not None and following.isdigit():
            self.i += 1
            self.day_numbers()  # "on day 20 and 30", "every year on the day 31"
        elif token in ("week", "weeks") and following is not None and following.isdigit():
            self.i += 1
            self.week_numbers()  # "in week 12 and 14"
        elif token in _UNITS:
            self.units.add(_UNITS[token])
            self.i += 1
        elif token in _TOO_OFTEN and _ordinal(token) is None:  # "second" counts: "the second friday"
            raise self.too_often(token)
        elif _ordinal(token) is not None:
            self.ordinal_phrase()
        elif _weekday(token) is not None:
            self.weekday_phrase()
        elif token in _GROUPS:
            self.weekdays.extend((day, None) for day in _GROUPS[token])
            self.i += 1
        elif _month(token) is not None:
            self.month_phrase()
        elif token.isdigit() and (_month(following) is not None or self.at(self.i - 1) in ("the", "on")
                                  or (following == "of" and _month(self.peek(2)) is not None)):
            self.day_numbers()  # "24 december", "on the 15"
        elif token in _FILLER:
            self.i += 1
        elif re.fullmatch(r"[a-z]{5,}", token) and difflib.get_close_matches(token, _FUZZY, n=1, cutoff=0.85):
            self.tokens[self.i] = difflib.get_close_matches(token, _FUZZY, n=1, cutoff=0.85)[0]
        else:
            self.unknown.append(token)
            self.i += 1

    def too_often(self, token: str) -> RecurrenceError:
        return RecurrenceError(f"“{self.text}” is too often: Plina repeats at most every hour.")

    def set_interval(self, amount: int, freq: int, raw: str) -> None:
        if amount < 1:
            raise RecurrenceError(f"“{raw}” is not an interval.")
        if self.interval not in (None, (amount, freq)):
            raise RecurrenceError(f"“{self.text}” says two different intervals.")
        self.interval = (amount, freq)

    def after_every(self) -> None:
        """What follows “every”: "every 4 weeks", "every other day", "every 3
        fridays", "every 4th day", "every 2nd friday"; else the main loop."""
        token, following = self.peek(), self.peek(1)
        if token in _TOO_OFTEN and (token != "second" or following is None):
            raise self.too_often(token)
        amount = 2 if token == "other" else _number(token)
        if amount is not None:
            if following in _UNITS:
                self.set_interval(amount, _UNITS[following], f"every {token} {following}")
                self.i += 2
            elif following in _TOO_OFTEN:
                raise self.too_often(following)
            elif following in ("fortnight", "fortnights"):
                self.set_interval(2 * amount, rrule.WEEKLY, f"every {token} {following}")
                self.i += 2
            elif _weekday(following) is not None or following in _GROUPS:
                self.set_interval(amount, rrule.WEEKLY, f"every {token} {following}")
                self.i += 1
            elif token == "other":
                self.unknown.append(token)
                self.i += 1
            return
        nth = _ordinal(token)
        if nth is not None and nth > 1:
            if following in _UNITS and self.at(self.i + 2) not in ("of", "in"):
                self.set_interval(nth, _UNITS[following], f"every {token} {following}")
                self.i += 2
            elif _weekday(following) is not None:
                first = len(self.weekdays)
                self.ordinal_phrase()
                self.every_nth = (nth, range(first, len(self.weekdays)))

    def ordinal_phrase(self) -> None:
        """"first and third friday", "2nd to the last fri", "the 15th", "last
        day", "the first and last instance of", "the last weekday"."""
        ordinals = []
        while _ordinal(self.peek()) is not None:
            raw, number = self.peek(), _ordinal(self.peek())
            self.i += 1
            if self.peek() == "to" and (self.peek(1) == "last" or self.peek(1) == "the" and self.peek(2) == "last"):
                self.i += 2 if self.peek(1) == "last" else 3
                raw, number = f"{raw} to last", -number
            ordinals.append((number, raw))
            if self.peek() in ("and", "or") and _ordinal(self.peek(1)) is not None:
                self.i += 1
        word = self.peek()
        if _weekday(word) is not None:
            while _weekday(self.peek()) is not None:
                for number, raw in ordinals:
                    if not 1 <= abs(number) <= 5:
                        raise RecurrenceError(f"“{raw} {self.peek()}”: a month has at most five of each weekday.")
                    self.weekdays.append((_weekday(self.peek()), number))
                self.i += 1
                if self.peek() in ("and", "or") and _weekday(self.peek(1)) is not None:
                    self.i += 1
        elif word in _GROUPS:
            self.setpos.extend(number for number, _ in ordinals)
            self.weekdays.extend((day, None) for day in _GROUPS[word])
            self.i += 1
        elif word in ("instance", "instances", "occurrence", "occurrences"):
            self.setpos.extend(number for number, _ in ordinals)
            self.i += 1
        elif word in ("day", "days"):
            self.nth_days.extend(ordinals)
            self.i += 1
        elif word in _UNITS:
            self.unknown.append(f"{ordinals[-1][1]} {word}")
            self.i += 1
        else:
            self.days.extend(ordinals)

    def weekday_phrase(self) -> None:
        first = _weekday(self.peek())
        self.i += 1
        if self.peek() in _RANGE_WORDS and _weekday(self.peek(1)) is not None:
            last = _weekday(self.peek(1))
            self.i += 2
            self.weekdays.extend(((first + offset) % 7, None) for offset in range((last - first) % 7 + 1))
        else:
            self.weekdays.append((first, None))

    def weekday_range_at(self, j: int) -> bool:
        return _weekday(self.at(j)) is not None and self.at(j + 1) in _RANGE_WORDS \
            and _weekday(self.at(j + 2)) is not None

    def month_phrase(self) -> None:
        """"march", "december 24th", "aug 20 and 30"."""
        self.months.append(_month(self.peek()))
        self.i += 1
        while _day_of_month(self.peek()) is not None and _weekday(self.peek(1)) is None:
            self.days.append((_day_of_month(self.peek()), self.peek()))
            self.i += 1
            if self.peek() in ("and", "or") and _day_of_month(self.peek(1)) is not None:
                self.i += 1

    def day_numbers(self) -> None:
        while self.peek() is not None and self.peek().isdigit():
            self.days.append((int(self.peek()), self.peek()))
            self.i += 1
            if self.peek() in ("and", "or") and (self.peek(1) or "").isdigit():
                self.i += 1

    def week_numbers(self) -> None:
        while self.peek() is not None and self.peek().isdigit():
            number = int(self.peek())
            if not 1 <= number <= 53:
                raise RecurrenceError(f"“week {number}”: weeks are numbered 1 to 53.")
            self.weeknos.append(number)
            self.i += 1
            if self.peek() in ("and", "or") and (self.peek(1) or "").isdigit():
                self.i += 1

    # Times of day.

    def time_at(self, j: int, after_at: bool):
        """A time at token ``j``: ((hour, minute), end, without am/pm) or None.
        A plain number is a time only after “at”: "at 18"."""
        token, following = self.at(j), self.at(j + 1)
        if token is None:
            return None
        meridiem = None
        if match := _CLOCK.match(token):
            hour, minute, meridiem = int(match[1]), int(match[2]), match[3]
        elif match := _HOUR_MERIDIEM.match(token):
            hour, minute, meridiem = int(match[1]), int(match[2] or 0), match[3]
        elif re.fullmatch(r"\d{1,2}", token) and (after_at or following in ("am", "pm", "oclock")):
            hour, minute = int(token), 0
        elif (match := _DOTTED_TIME.match(token)) and (after_at or following in ("am", "pm")):
            hour, minute = int(match[1]), int(match[2])
        else:
            return None
        end = j + 1
        if meridiem is None and self.at(end) in ("am", "pm"):
            meridiem = self.at(end)
            end += 1
        if self.at(end) == "oclock":
            end += 1
        raw = " ".join(self.tokens[j:end])
        if meridiem:
            if not 1 <= hour <= 12:
                raise RecurrenceError(f"“{raw}” is not a time.")
            hour = hour % 12 + (12 if meridiem.startswith("p") else 0)
        if hour > 23 or minute > 59:
            raise RecurrenceError(f"“{raw}” is not a time of day (00:00 to 23:59).")
        return (hour, minute), end, meridiem is None

    def time_list(self, after_at: bool) -> None:
        """"at 9:00", "at 9 and 14", "8pm"."""
        found = self.time_at(self.i, after_at)
        while found:
            moment, end, bare = found
            if moment not in self.times:
                self.times.append(moment)
            self.bare_time = (self.times.index(moment), end) if bare and moment[0] <= 12 else None
            self.i = end
            found = self.time_at(self.i + 1, after_at=True) if self.peek() in ("and", "or") else None

    def daytime(self, token: str) -> None:
        """"evenings" (18:00) — or "at 7 in the evening" (19:00)."""
        name = token[:-1] if token.endswith("s") else token
        if self.bare_time and all(word in ("in", "the", "at") for word in self.tokens[self.bare_time[1]:self.i]):
            index = self.bare_time[0]
            hour, minute = self.times[index]
            if name in ("afternoon", "evening") and hour < 12 or name == "night" and 6 <= hour < 12:
                hour += 12
            elif name == "midnight" and hour == 12:
                hour = 0
            self.times[index] = (hour, minute)
            self.bare_time = None
        elif _DAYTIMES[token] not in self.times:
            self.times.append(_DAYTIMES[token])
        self.i += 1

    # Clauses: how long, how often in all, except when.

    def count_at(self, j: int):
        """"10x", "3 times", "5 occurrences", "twice": (count, end) or None."""
        token = self.at(j)
        if token == "twice":
            return 2, j + 1
        if token is not None and (match := _TIMES_X.match(token)):
            return int(match[1]), j + 1
        if _number(token) is not None and self.at(j + 1) in _COUNTED:
            if _number(token) < 1:
                raise RecurrenceError(f"“{token} {self.at(j + 1)}” is not a number of times.")
            return _number(token), j + 2
        return None

    def for_clause(self) -> None:
        """"for 3 times", "for the next 3 weeks", "for up to 14 months"."""
        j = self.i + 1
        if self.at(j) == "up" and self.at(j + 1) == "to":
            j += 2
        if self.count_at(j):
            self.count, self.i = self.count_at(j)
            return
        if self.at(j) == "the":
            j += 1
        if self.at(j) == "next":
            j += 1
        amount = 1
        if self.at(j) in ("a", "an"):
            j += 1
        elif _number(self.at(j)) is not None:
            amount = _number(self.at(j))
            j += 1
        if self.at(j) in _PERIODS and amount >= 1:
            self.until = DateSpec("after", unit=self.at(j).rstrip("s"), amount=amount)
            self.i = j + 1
        else:
            self.unknown.append("for")
            self.i += 1

    def date_at(self, j: int, weekday: bool = False):
        """A date at token ``j`` ("march 3rd", "jan 1 2010", "next tuesday",
        "in april", "2026-10-05", "24.12.2026", "the 2nd monday in march"):
        (DateSpec, end) or None. ``weekday``: "tuesday" is the next one."""
        while self.at(j) == "on":
            j += 1
        token, following = self.at(j), self.at(j + 1)
        if token is None:
            return None
        if token in ("today", "tomorrow"):
            return DateSpec(token), j + 1
        if token in ("next", "this"):
            if _weekday(following) is not None:
                return DateSpec("weekday", weekday=_weekday(following), strict=token == "next"), j + 2
            if token == "next" and following in ("week", "month", "year"):
                return DateSpec("next", unit=following), j + 2
            return None
        if weekday and _weekday(token) is not None:
            return DateSpec("weekday", weekday=_weekday(token)), j + 1
        if token == "in":
            if _month(following) is not None:
                year = _year(self.at(j + 2))
                return DateSpec("month", month=_month(following), year=year), j + (3 if year else 2)
            amount = 1 if following in ("a", "an") else _number(following)
            if amount and self.at(j + 2) in _PERIODS:
                return DateSpec("after", unit=self.at(j + 2).rstrip("s"), amount=amount), j + 3
            return None
        if match := _ISO_DATE.match(token):
            year, month, day = int(match[1]), int(match[2]), int(match[3])
            if not 1 <= month <= 12:
                raise RecurrenceError(f"“{token}” is not a date.")
            _valid_date(year, month, day, token)
            return DateSpec("date", year=year, month=month, day=day), j + 1
        if match := _DOTTED_DATE.match(token):
            day, month = int(match[1]), int(match[2])
            year = int(match[3]) + (2000 if len(match[3]) == 2 else 0) if match[3] else None
            if not 1 <= month <= 12:
                raise RecurrenceError(f"“{token}” is not a date.")
            _valid_date(year, month, day, token)
            return DateSpec("date", year=year, month=month, day=day), j + 1
        k = j + 1 if token == "the" else j
        number = _ordinal(self.at(k)) if _ordinal(self.at(k)) is not None else _number(self.at(k))
        if number is not None:
            day = _weekday(self.at(k + 1))
            if _ordinal(self.at(k)) is not None and day is not None and self.at(k + 2) in ("in", "of") \
                    and _month(self.at(k + 3)) is not None:
                year = _year(self.at(k + 4))
                return DateSpec("nth", month=_month(self.at(k + 3)), weekday=day, nth=number, year=year), \
                    k + (5 if year else 4)
            at_month = k + (2 if self.at(k + 1) == "of" else 1)
            if _month(self.at(at_month)) is not None and 1 <= number <= 31:
                month, year = _month(self.at(at_month)), _year(self.at(at_month + 1))
                _valid_date(year, month, number, " ".join(self.tokens[k:at_month + 1]))
                return DateSpec("date", year=year, month=month, day=number), at_month + (2 if year else 1)
            return None
        if _month(token) is not None:
            month, k = _month(token), j + 1
            day = _day_of_month(self.at(k))
            if day is not None:
                _valid_date(_year(self.at(k + 1)), month, day, f"{token} {self.at(k)}")
                k += 1
            year = _year(self.at(k))
            if year:
                k += 1
            return DateSpec("date" if day else "month", year=year, month=month, day=day), k
        return None

    def exclusion_clause(self) -> None:
        """"except on weekends", "except in july and sept", "except tomorrow",
        "except on june 23rd and july 4th", "except each 2nd monday in march"."""
        if self.peek() == "for":
            self.i += 1
        while self.i < len(self.tokens):
            token = self.peek()
            if token in ("on", "in", "the", "and", "or", "each", "every", "of", "month", "months", "except"):
                self.i += 1
            elif token in ("starting", "commencing", "for", "until", "till", "til", "untill", "ending", "up", "at") \
                    or token in _START_WORDS | _UNTIL_WORDS and self.date_at(self.i + 1, weekday=True) \
                    or self.time_at(self.i, after_at=False) or self.count_at(self.i):
                return  # the rest of the rule
            elif found := self.exclusion_at(self.i):
                exclusion, self.i = found
                self.exclusions.append(exclusion)
            else:
                self.unknown.append(token)
                self.i += 1

    def exclusion_at(self, j: int):
        token = self.at(j)
        if _weekday(token) is not None:
            return Exclusion(weekdays=((_weekday(token), None),)), j + 1
        if token in _GROUPS:
            return Exclusion(weekdays=tuple((day, None) for day in _GROUPS[token])), j + 1
        number = _ordinal(token)
        if number is not None and _month(self.at(j + 1 + (self.at(j + 1) == "of"))) is None:
            k = j + 1
            if _weekday(self.at(k)) is not None:
                if not 1 <= abs(number) <= 5:
                    raise RecurrenceError(f"“{token} {self.at(k)}”: a month has at most five of each weekday.")
                weekday, k = _weekday(self.at(k)), k + 1
                months = ()
                if self.at(k) in ("in", "of") and _month(self.at(k + 1)) is not None:
                    months, k = (_month(self.at(k + 1)),), k + 2
                return Exclusion(weekdays=((weekday, number),), months=months), k
            if not 1 <= abs(number) <= 31:
                raise RecurrenceError(f"“{token}” is not a day of the month.")
            return Exclusion(monthdays=(number,)), k + (self.at(k) == "day")
        if _month(token) is not None and _day_of_month(self.at(j + 1)) is None:
            year = _year(self.at(j + 1))
            return Exclusion(months=(_month(token),), year=year), j + (2 if year else 1)
        found = self.date_at(j)
        if found is None:
            return None
        spec, end = found
        if spec.kind == "date" and spec.year is None:  # "december 24th": every year
            return Exclusion(months=(spec.month,), monthdays=(spec.day,)), end
        if spec.kind == "month":
            return Exclusion(months=(spec.month,), year=spec.year), end
        return Exclusion(on=spec), end

    # The rule.

    def build(self) -> Rule:
        interval = self.interval
        weekdays = list(self.weekdays)
        month_context = bool(self.months) or bool({rrule.MONTHLY, rrule.YEARLY} & self.units) \
            or interval is not None and interval[1] in (rrule.MONTHLY, rrule.YEARLY)
        if self.every_nth is not None and not month_context:
            # "every 2nd friday", no month: every other Friday.
            nth, indexes = self.every_nth
            for index in indexes:
                weekdays[index] = (weekdays[index][0], None)
            if interval is None:
                interval = (nth, rrule.WEEKLY)
        has_nth = any(nth is not None for _, nth in weekdays)
        if interval is not None:
            freq, every = interval[1], interval[0]
        elif self.units:
            freq, every = min(self.units), 1  # the longest period said: "the 4th day of every month"
        elif self.months or self.weeknos:
            freq, every = rrule.YEARLY, 1
        elif has_nth or self.days or self.nth_days or self.setpos:
            freq, every = rrule.MONTHLY, 1
        elif weekdays:
            freq, every = rrule.WEEKLY, 1
        elif self.times:
            freq, every = rrule.DAILY, 1
        else:
            raise RecurrenceError(f"When does it repeat? E.g. {EXAMPLES}.")

        days = list(self.days)
        if freq == rrule.WEEKLY and not month_context:
            for number, raw in self.nth_days:  # "every week on the 4th day": Thursday
                if not 1 <= number <= 7:
                    raise RecurrenceError(f"“{raw} day”: a week has 7 days.")
                weekdays.append((number - 1, None))
        else:
            days += self.nth_days
        monthdays, yeardays = [], []
        for number, raw in days:
            if freq == rrule.YEARLY and not self.months:
                if not 1 <= abs(number) <= 366:
                    raise RecurrenceError(f"“{raw}” is not a day of the year.")
                yeardays.append(number)
            else:
                if not 1 <= abs(number) <= 31:
                    raise RecurrenceError(f"“{raw}” is not a day of the month.")
                monthdays.append(number)
        if monthdays and freq in (rrule.HOURLY, rrule.DAILY, rrule.WEEKLY):
            raise RecurrenceError("A day of the month needs “every month”, e.g. “every month on the 15th”.")
        if has_nth and freq in (rrule.HOURLY, rrule.DAILY, rrule.WEEKLY):
            word = next(_ordinal_name(nth) for _, nth in weekdays if nth is not None)
            raise RecurrenceError(f"“{word}” needs a month, e.g. “every first sunday of the month”.")
        if self.weeknos and freq != rrule.YEARLY:
            raise RecurrenceError("A week number needs “every year”, e.g. “every friday in week 12”.")
        if self.setpos and not weekdays:
            raise RecurrenceError(f"“{_ordinal_name(self.setpos[0])} instance” of what? "
                                  "E.g. “the last instance of tuesday and friday each month”.")
        if freq == rrule.HOURLY and self.times:
            raise RecurrenceError("“every hour” and a time of day do not go together.")
        if self.months and monthdays and not weekdays and not any(
                day < 0 or day <= _MONTH_LENGTHS[month] for day in monthdays for month in self.months):
            raise RecurrenceError(f"{_MONTH_NAMES[self.months[0] - 1]} has no {_day_name(monthdays[0])}.")
        if freq == rrule.YEARLY and self.months and not (weekdays or monthdays or yeardays or self.weeknos):
            monthdays = [1]  # "every year in march": on the 1st

        unique = lambda items: tuple(dict.fromkeys(items))  # noqa: E731 (in order, once)
        exclusions, months_out, days_out = [], [], []
        for exclusion in self.exclusions:  # "except in july and sept": one exclusion, read as one
            if exclusion == Exclusion(months=exclusion.months):
                months_out += exclusion.months
            elif exclusion == Exclusion(weekdays=exclusion.weekdays) and all(n is None for _, n in exclusion.weekdays):
                days_out += exclusion.weekdays
            else:
                exclusions.append(exclusion)
        if days_out:
            exclusions.insert(0, Exclusion(weekdays=unique(days_out)))
        if months_out:
            exclusions.insert(0, Exclusion(months=unique(months_out)))
        return Rule(freq=freq, interval=every, weekdays=unique(weekdays), monthdays=unique(monthdays),
                    yeardays=unique(yeardays), weeknos=unique(self.weeknos), months=unique(self.months),
                    setpos=unique(self.setpos), times=tuple(sorted(self.times)), count=self.count,
                    start=self.start, until=self.until, exclusions=unique(exclusions), text=self.text)


@lru_cache(maxsize=512)
def parse_rule(text: str) -> Rule:
    """The rule ``text`` means, or :class:`RecurrenceError` saying why not."""
    return _Parser(text).parse()


def describe(rule: Rule) -> str:
    """The rule in normalized words: "every 4 weeks on Tuesday at 14:00"."""
    unit = _UNIT_NAMES[rule.freq]
    every = f"every {rule.interval} {unit}s" if rule.interval > 1 else f"every {unit}"
    plain = [day for day, nth in rule.weekdays if nth is None]
    nth = _nth_names(rule.weekdays)
    months = _join(_MONTH_NAMES[month - 1] for month in rule.months)
    only_days = not (rule.monthdays or rule.yeardays or rule.weeknos)
    if rule.setpos:
        text = f"{every} on the {_join(_ordinal_name(p) for p in rule.setpos)} {_days_name(plain, 'or')}"
        if rule.months:
            text += f" in {months}"
    elif rule.freq == rrule.WEEKLY and rule.interval == 1 and plain and not nth and only_days and not rule.months:
        text = "every " + _days_name(plain)
    elif rule.freq == rrule.MONTHLY and rule.interval == 1 and nth and not plain and only_days and not rule.months:
        text = f"every {_join(nth)} of the month"
    elif rule.freq == rrule.YEARLY and rule.interval == 1 and nth and not plain and only_days and rule.months:
        text = f"every {_join(nth)} in {months}"
    elif rule.freq == rrule.YEARLY and rule.months and rule.monthdays and not rule.weekdays:
        text = f"{every} on {months} {_join(_day_name(day) for day in rule.monthdays)}"
    else:
        text = every
        if rule.weekdays:
            days = _days_name(plain)
            days += "s" if days in ("weekday", "weekend") else ""  # "every 2 weeks on weekends"
            text += " on " + _join(([days] if plain else []) + [f"the {item}" for item in nth])
        if rule.monthdays:
            text += " on the " + _join(_day_name(day) for day in rule.monthdays)
        if rule.yeardays:
            text += " on day " + _join(str(day) for day in rule.yeardays)
        if rule.weeknos:
            text += " in week " + _join(str(week) for week in rule.weeknos)
        if rule.months:
            text += f" in {months}"
    if rule.times:
        text += " at " + _join(f"{hour:02d}:{minute:02d}" for hour, minute in rule.times)
    if rule.start:
        text += " starting " + rule.start.label
    if rule.until:
        text += (" for " if rule.until.kind == "after" else " until ") + rule.until.label
    if rule.count:
        text += ", once" if rule.count == 1 else f", {rule.count} times"
    if rule.exclusions:
        text += " except " + _join(exclusion.label for exclusion in rule.exclusions)
    return text


def _local(moment: datetime, zone: tzinfo) -> datetime:
    return timezone.localtime(moment, zone).replace(tzinfo=None, second=0, microsecond=0)


def occurrences(rule: Rule, anchor: datetime, start: datetime, end: datetime,
                zone: Optional[tzinfo] = None) -> List[datetime]:
    """The occurrences from ``start`` to ``end`` (inclusive) of the series
    that began at ``anchor``, as aware datetimes; the rule's wall-clock time
    in ``zone`` (default: the active zone)."""
    zone = zone or timezone.get_current_timezone()
    first, last = _local(start, zone), _local(end, zone)
    series = rule.series(_local(anchor, zone), earliest=first)
    return [timezone.make_aware(moment, zone) for moment in series.between(first, last)]


def first_occurrences(rule: Rule, anchor: datetime, count: int, zone: Optional[tzinfo] = None) -> List[datetime]:
    """The first ``count`` occurrences from ``anchor`` on, as aware datetimes."""
    zone = zone or timezone.get_current_timezone()
    start = _local(anchor, zone)
    found = []
    for moment in rule.series(start)._iterate(start, start + relativedelta(years=50)):
        found.append(timezone.make_aware(moment, zone))
        if len(found) >= count:
            break
    return found


def next_occurrence(rule: Rule, anchor: datetime, after: datetime,
                    zone: Optional[tzinfo] = None) -> Optional[datetime]:
    """The first occurrence strictly after ``after`` (None if the series ended)."""
    zone = zone or timezone.get_current_timezone()
    moment = _local(after, zone)
    found = rule.series(_local(anchor, zone), earliest=moment).after(moment)
    return timezone.make_aware(found, zone) if found is not None else None
