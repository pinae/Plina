from __future__ import annotations
from typing import List
from django.conf import settings
from django.db import models
from django.utils import timezone
from datetime import time, timedelta, datetime
from uuid import uuid4
import re

from plina.scoping import Owned


def minutely_str(duration):
    total_seconds = int(duration.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    if minutes == 0:
        return f"{hours}h"
    return f"{hours}h {minutes}m"


# Every model below holds a user's data (Owned, plina.scoping): queries see
# only the rows of the logged-in user, new rows belong to them.


class OptionallyColored(Owned):
    color = models.BinaryField(max_length=3, default=b"\x53\x9d\xad", blank=True, null=True)  # byte order: rgb

    class Meta(Owned.Meta):
        abstract = True

    @property
    def hex_color(self) -> str:
        return "#" + self.color.hex() if self.color is not None else "#539dad"

    @hex_color.setter
    def hex_color(self, new_color: str | None):
        if type(new_color) is str and re.search(r"^#?[0-9a-fA-F]{6}$", new_color):
            if new_color.startswith("#"):
                new_color = new_color[1:]
            self.color = bytes.fromhex(new_color)
        else:
            self.color = None

    def has_color(self) -> bool:
        return self.color is not None

    @staticmethod
    def mix_colors(colors: List[bytes]) -> bytes:
        r, g, b = 0, 0, 0
        for color in colors:
            r += color[0]
            g += color[1]
            b += color[2]
        return bytes([int(round(r / len(colors))),
                      int(round(g / len(colors))),
                      int(round(b / len(colors)))])


class Tag(OptionallyColored):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    name = models.CharField(max_length=256)

    def __str__(self) -> str:
        return "#{}".format(self.name)


class Task(OptionallyColored):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    header = models.CharField(max_length=1024)
    description = models.TextField(default="", blank=True)
    start_date = models.DateTimeField("start date", blank=True, null=True, default=None)
    duration = models.DurationField(blank=True, null=True, default=None)
    latest_finish_date = models.DateTimeField("due until", blank=True, null=True, default=None)
    time_spent = models.DurationField(default=timedelta(seconds=0))
    priority = models.FloatField(default=5.0)
    tags = models.ManyToManyField(to=Tag, related_name="tasks", blank=True)
    is_fixed = models.BooleanField(default=False)
    is_appointment = models.BooleanField(default=False)
    completed_at = models.DateTimeField("completed at", blank=True, null=True, default=None)
    #: Task tree (UI-1): every top-level task is a project; tasks can be split
    #: indefinitely. RESTRICT so children are never deleted by accident — the
    #: API decides whether they are lifted or deleted (services.tree) — but
    #: the whole tree goes with its owner when a user is deleted.
    parent = models.ForeignKey(to="self", related_name="children", null=True, blank=True,
                               default=None, on_delete=models.RESTRICT)
    #: Position among the siblings (the top-level order is the project order).
    order = models.PositiveIntegerField(default=0)
    #: Colors (§4.4, services.colors): the chosen color (None = inherit from
    #: the parent), and the automatic one a top-level task without a chosen
    #: color shows — assigned once, kept while the task is nested.
    color = models.BinaryField(max_length=3, blank=True, null=True, default=None)  # rgb
    auto_color = models.BinaryField(max_length=3, blank=True, null=True, default=None)
    # Completion snapshot (§4.6): estimate vs. reality, kept for analysis.
    completion_estimate = models.DurationField(null=True, blank=True, default=None)
    completion_first_estimate = models.DurationField(null=True, blank=True, default=None)
    completion_time_spent = models.DurationField(null=True, blank=True, default=None)
    completion_subtree_time_spent = models.DurationField(null=True, blank=True, default=None)
    completion_dropped_rest = models.DurationField(null=True, blank=True, default=None)
    #: Recurring tasks (README: Recurring tasks, services.series): the series
    #: this task is one occurrence of, and the moment of that occurrence.
    #: Every occurrence is completed and tracked on its own.
    series = models.ForeignKey(to="TaskSeries", related_name="occurrences", null=True, blank=True,
                               default=None, on_delete=models.SET_NULL)
    occurrence = models.DateTimeField(null=True, blank=True, default=None)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["series", "occurrence"], name="one_task_per_occurrence"),
        ]

    @property
    def is_done(self) -> bool:
        return self.completed_at is not None

    def __str__(self) -> str:
        return "{} ({:.2f}) - ID: {}".format(self.header, self.priority, str(self.id))


class TaskSeries(Owned):
    """A recurring task's rule (README: Recurring tasks): its occurrences
    are tasks of their own (``Task.series``), made by services.series — an
    appointment's for the planning horizon ahead, any other task's when its
    date is reached."""
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    #: As typed, e.g. "every tuesday at 20:00" (services.recurrence).
    recurrence = models.CharField(max_length=256)
    #: Where the rule's counting starts, so "every 4 weeks" keeps its rhythm.
    anchor = models.DateTimeField()
    #: Occurrences deleted on their own (ISO timestamps): not made again.
    skipped = models.JSONField(default=list, blank=True)

    class Meta:
        verbose_name_plural = "task series"

    def __str__(self) -> str:
        return self.recurrence


class TaskEstimateChange(Owned):
    """One change of a task's estimate (§4.6) — the history is kept so
    estimates can be compared with tracked time when analyzing projects."""
    REASONS = [
        ("created", "created"),
        ("edited", "edited"),
        ("split", "split"),
        ("set_to_sum", "set to sum of parts"),
        ("raised_from_warning", "raised from over-budget warning"),
        ("migrated", "migrated from a project"),
    ]
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    task = models.ForeignKey(to=Task, related_name="estimate_changes", on_delete=models.CASCADE)
    old_duration = models.DurationField(null=True, blank=True, default=None)
    new_duration = models.DurationField(null=True, blank=True, default=None)
    changed_at = models.DateTimeField(default=timezone.now)
    reason = models.CharField(max_length=32, choices=REASONS)

    class Meta:
        ordering = ["changed_at"]

    def __str__(self) -> str:
        return f"{self.task.header}: {self.old_duration} → {self.new_duration} ({self.reason})"


class TaskDependency(Owned):
    """A finish-to-start edge: ``successor`` may not start before ``predecessor`` is done.

    The dependency graph must stay acyclic; cycle checks live in the service
    layer (``services.graph``) and API validation. The database only enforces
    what it can express cheaply: no self-edges, no duplicates.
    """
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    predecessor = models.ForeignKey(to=Task, related_name="outgoing_dependencies",
                                    on_delete=models.CASCADE)
    successor = models.ForeignKey(to=Task, related_name="incoming_dependencies",
                                  on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["predecessor", "successor"],
                                    name="unique_task_dependency"),
            models.CheckConstraint(condition=~models.Q(predecessor=models.F("successor")),
                                   name="no_self_dependency"),
        ]

    def __str__(self) -> str:
        return f"{self.predecessor.header} -> {self.successor.header}"


class TimeBucketType(Owned):
    name = models.CharField(max_length=512)
    #: Colors like a project's (§4.4, services.colors): the chosen color
    #: (None = automatic) and the automatic one, assigned once.
    color = models.BinaryField(max_length=3, blank=True, null=True, default=None)  # rgb
    auto_color = models.BinaryField(max_length=3, blank=True, null=True, default=None)
    tags = models.ManyToManyField(to=Tag, related_name="time_bucket_types")
    start_times = models.CharField(max_length=512, default="")
    #: Where the rule's counting starts (services.recurrence): "every other
    #: week", "for the next 3 weeks" and "10 times" count from here. The
    #: serializer resets it when the rule changes.
    anchor = models.DateTimeField(default=timezone.now)
    duration = models.DurationField(default=timedelta(hours=4))

    def __str__(self):
        return (f"{self.name}: ({minutely_str(self.duration)}) {self.start_times} " +
                ",".join([f"#{tag.name}" for tag in self.tags.all()]))

    @property
    def hex_color(self) -> str:
        """The color its buckets show: the chosen one, else the automatic one."""
        color = self.color if self.color is not None else self.auto_color
        return "#" + bytes(color).hex() if color is not None else "#539dad"

    @hex_color.setter
    def hex_color(self, new_color: str | None):
        """Sets the chosen color; None = automatic."""
        self.color = bytes.fromhex(new_color.lstrip("#")) if new_color else None

    def generate_buckets(self, generation_range: timedelta, start: datetime | None = None) -> List[TimeBucket]:
        if start is None:
            start = timezone.now()
        start = start.replace(second=0, microsecond=0)
        if not self.start_times.strip():
            return []  # manual-only type: buckets are placed by hand
        # Rules speak wall-clock time ("at 14:00") in the user's zone (the
        # active one, see UserTimeZoneMiddleware) — whatever zone ``start``
        # comes in. Each occurrence gets its own offset, so 14:00 stays 14:00
        # across a daylight-saving change (services.recurrence).
        from tasks.services.recurrence import RecurrenceError, occurrences, parse_rule
        try:
            rule = parse_rule(self.start_times)
        except RecurrenceError:
            return []  # not a recognizable recurrence rule
        buckets = []
        for start_date in occurrences(rule, self.anchor or start, start, start + generation_range):
            buckets.append(TimeBucket(start_date=start_date, duration=self.duration, type=self))
        return buckets


class TimeBucket(Owned):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    start_date = models.DateTimeField("start date", default=timezone.now)
    duration = models.DurationField(default=timedelta(hours=4))
    type = models.ForeignKey(to=TimeBucketType, related_name="buckets", on_delete=models.CASCADE, null=False)
    #: When a single recurring occurrence is moved/resized, this records the
    #: original generated start it replaces so the recurrence rule no longer
    #: regenerates a duplicate at that slot (see services.bucket_service).
    origin_date = models.DateTimeField("original occurrence", null=True, blank=True, default=None)

    def __str__(self):
        return f"{self.start_date} - {self.end_date}: {self.type.name}"

    @property
    def end_date(self) -> datetime:
        return self.start_date + self.duration

    @end_date.setter
    def set_end_date(self, new_end_date: datetime):
        self.duration = new_end_date - self.start_date


class TrackingSession(Owned):
    """One stretch of actually working on a task.

    An open session (``end`` is null) means the user is working right now;
    only one session may be open at a time.  Session bookkeeping lives in
    ``services/tracking.py`` — the model only holds data.
    """
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    task = models.ForeignKey(to=Task, related_name="tracking_sessions",
                             on_delete=models.CASCADE)
    start = models.DateTimeField()
    end = models.DateTimeField(null=True, blank=True, default=None)

    class Meta:
        ordering = ["start"]

    def __str__(self) -> str:
        state = "…" if self.end is None else f"– {self.end:%H:%M}"
        return f"{self.task.header}: {self.start:%Y-%m-%d %H:%M} {state}"


class Plan(Owned):
    """One stored schedule: a valid topological ordering packed into buckets.

    Several unaccepted candidate plans coexist while the user chooses; on
    acceptance the chosen plan survives alone (A4).  Accepting never fixes
    tasks — fluidity is preserved, only tracking/manual placement anchors.
    """
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    label = models.CharField(max_length=512)
    is_accepted = models.BooleanField(default=False)
    feasible = models.BooleanField(default=True)
    #: Generation parameters ({"preset": ..., "focus_task_ids": [...]}) so a
    #: recalculation can preserve the spirit of the accepted choice.
    config = models.JSONField(default=dict)
    #: Metadata of not-yet-materialized (generated) buckets used by entries:
    #: {bucket_key: {"start_date": iso, "duration_seconds": int, "type_id": str}}.
    #: Consumed when the plan is accepted (A8: materialize on acceptance).
    buckets_snapshot = models.JSONField(default=dict)
    metrics = models.JSONField(default=dict)
    warnings = models.JSONField(default=list)

    def __str__(self) -> str:
        marker = "✓ " if self.is_accepted else ""
        return f"{marker}{self.label} ({self.created_at:%Y-%m-%d %H:%M})"


class PlanEntry(Owned):
    """One contiguous slice of a task inside the plan.

    ``bucket`` is null for appointments (calendar-level) and for slices in
    buckets that have not been materialized yet — those carry ``bucket_key``
    referencing the plan's ``buckets_snapshot`` until acceptance.
    """
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    plan = models.ForeignKey(to=Plan, related_name="entries", on_delete=models.CASCADE)
    task = models.ForeignKey(to=Task, related_name="plan_entries", on_delete=models.CASCADE)
    bucket = models.ForeignKey(to=TimeBucket, related_name="plan_entries",
                               null=True, blank=True, on_delete=models.SET_NULL)
    bucket_key = models.UUIDField(null=True, blank=True, default=None)
    start = models.DateTimeField()
    duration = models.DurationField()
    order = models.PositiveIntegerField()
    #: A slice of the parent's Rest placeholder (``task`` is the parent, UI-2).
    is_rest = models.BooleanField(default=False)

    class Meta:
        ordering = ["order"]
        verbose_name_plural = "plan entries"

    def __str__(self) -> str:
        return f"[{self.order}] {self.task.header} at {self.start}"


class UserSettings(Owned):
    """Per-user preferences (UI-3): one row per user
    (``services.settings.get_settings``)."""
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, related_name="plina_settings",
                                 on_delete=models.CASCADE, editable=False)
    #: Planning estimate for tasks without an own estimate.
    default_duration = models.DurationField(default=timedelta(hours=1))
    #: The project (top-level task or task with subtasks) the user works in;
    #: preselected as parent of new tasks and synced to all devices.
    active_task = models.ForeignKey(to=Task, related_name="+", null=True, blank=True,
                                    default=None, on_delete=models.SET_NULL)
    #: IANA name (e.g. "Europe/Berlin"), sent by the browser; recurrence
    #: rules ("every day at 14:00") and messages use it. Empty = server zone.
    time_zone = models.CharField(max_length=64, blank=True, default="")
    #: The time frame the Week view opens on, filling the screen: the user's
    #: usual work hours.
    week_view_start = models.TimeField(default=time(8, 0))
    week_view_end = models.TimeField(default=time(16, 45))

    class Meta:
        verbose_name_plural = "user settings"

    def __str__(self) -> str:
        return f"Settings (default {minutely_str(self.default_duration)})"
