from __future__ import annotations
from typing import List
from django.db import models
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.utils import timezone
from datetime import timedelta, datetime
from parsedatetime import Constants as pdtConstants
from recurrent.event_parser import RecurringEvent
from dateutil import rrule
from uuid import uuid4
import re


def minutely_str(duration):
    total_seconds = int(duration.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    if minutes == 0:
        return f"{hours}h"
    return f"{hours}h {minutes}m"


class OptionallyColored(models.Model):
    color = models.BinaryField(max_length=3, default=b"\x53\x9d\xad", blank=True, null=True)  # byte order: rgb

    class Meta:
        abstract = True

    @property
    def hex_color(self) -> str:
        return "#" + self.color.hex() if self.color is not None else "#539dad"

    @hex_color.setter
    def set_hex_color(self, new_color: str | None):
        if type(new_color) is str and re.search(r"^#?[0-9,a-f]{6}$", new_color):
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
    description = models.TextField(default="")
    start_date = models.DateTimeField("start date", blank=True, null=True, default=None)
    duration = models.DurationField(blank=True, null=True, default=None)
    latest_finish_date = models.DateTimeField("due until", blank=True, null=True, default=None)
    time_spent = models.DurationField(default=timedelta(seconds=0))
    priority = models.FloatField(default=5.0)
    tags = models.ManyToManyField(to=Tag, related_name="tasks", blank=True)
    is_fixed = models.BooleanField(default=False)
    is_appointment = models.BooleanField(default=False)
    completed_at = models.DateTimeField("completed at", blank=True, null=True, default=None)

    @property
    def is_done(self) -> bool:
        return self.completed_at is not None

    def __str__(self) -> str:
        return "{} ({:.2f}) - ID: {}".format(self.header, self.priority, str(self.id))

    @property
    def project(self):
        try:
            return self.project_item.project
        except Task.project_item.RelatedObjectDoesNotExist:
            return None

    @project.setter
    def set_project(self, project: Project):
        project.add(self)

    def has_project(self) -> bool:
        return hasattr(self, 'project_item') and self.project_item is not None

    def get_color(self) -> bytes:
        if self.color is not None:
            return self.color
        if self.has_project() and self.project_item.project.has_color():
            return self.project_item.project.color
        colored_tags = self.tags.exclude(color=None).all()
        if colored_tags.count() > 0:
            return self.mix_colors([tag.color for tag in colored_tags])
        else:
            colored_tags = self.project_item.project.tags.exclude(color=None).all()
            if colored_tags.count() > 0:
                return self.mix_colors([tag.color for tag in colored_tags])
            else:
                return b'\x53\x9d\xad'


class Project(OptionallyColored):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    name = models.CharField(max_length=512)
    description = models.TextField(default="")
    tags = models.ManyToManyField(to=Tag, related_name="projects", blank=True)
    priority = models.FloatField(default=5.0)
    order = models.PositiveIntegerField(default=0)

    def __str__(self):
        return "Project {}: {} ({:d}:{:.2f})".format(str(self.id), self.name, self.order, self.priority)

    @property
    def tasks(self) -> List[Task]:
        return [pti.task for pti in self.task_list.order_by('order', '-task__priority').all()]

    def add(self, task: Task):
        task_item = ProjectTaskItem(project=self, task=task, order=ProjectTaskItem.objects.filter(project=self).count())
        task_item.save()

    def insert(self, task: Task, position: int = 0):
        new_task_item = ProjectTaskItem(project=self, task=task, order=0)
        for i, pti in enumerate(ProjectTaskItem.objects.filter(project=self).order_by("order").all()):
            if i == position:
                new_task_item.order = pti.order
            if i >= position:
                pti.order = pti.order + 1
                pti.save()
        new_task_item.save()

    def remove(self, task: Task):
        try:
            pti = ProjectTaskItem.objects.get(project=self, task=task)
            for subsequent_pti in ProjectTaskItem.objects.filter(project=self, order__gt=pti.order):
                subsequent_pti.order = subsequent_pti.order - 1
                subsequent_pti.save()
            pti.delete()
        except ProjectTaskItem.DoesNotExist:
            pass

    def get_color(self) -> bytes:
        if self.color is not None:
            return self.color
        colored_tags = self.tags.exclude(color=None).all()
        if colored_tags.count() > 0:
            return self.mix_colors([tag.color for tag in colored_tags])
        else:
            return b'\x53\x9d\xad'

    class Meta:
        ordering = ['order']


class ProjectTaskItem(models.Model):
    project = models.ForeignKey(to=Project, related_name="task_list", on_delete=models.CASCADE)
    task = models.OneToOneField(to=Task, related_name="project_item", on_delete=models.CASCADE)
    order = models.PositiveIntegerField()

    class Meta:
        ordering = ['order']


@receiver(pre_delete, sender=Task)
def pre_task_delete(sender, instance: Task, using, **kwargs):
    for pti in ProjectTaskItem.objects.filter(task=instance).all():
        pti.project.remove(instance)


class TaskDependency(models.Model):
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


class TimeBucketType(models.Model):
    name = models.CharField(max_length=512)
    color = models.BinaryField(max_length=3, default=b"\x53\x9d\xad")  # byte order: rgb
    tags = models.ManyToManyField(to=Tag, related_name="time_bucket_types")
    start_times = models.CharField(max_length=512, default="")
    duration = models.DurationField(default=timedelta(hours=4))

    def __str__(self):
        return (f"{self.name}: ({minutely_str(self.duration)}) {self.start_times} " +
                ",".join([f"#{tag.name}" for tag in self.tags.all()]))

    @property
    def hex_color(self) -> str:
        return "#" + self.color.hex()

    @hex_color.setter
    def set_hex_color(self, new_color: str):
        if new_color.startswith("#"):
            new_color = new_color[1:]
        self.color = bytes.fromhex(new_color)

    def generate_buckets(self, generation_range: timedelta, start: datetime | None = None) -> List[TimeBucket]:
        if start is None:
            start = timezone.now()
        start = start.replace(second=0, microsecond=0)
        if not self.start_times.strip():
            return []  # manual-only type: buckets are placed by hand
        consts = pdtConstants(localeID='de_DE', usePyICU=False)
        consts.use24 = True
        r = RecurringEvent(now_date=start, parse_constants=consts)
        r.parse(self.start_times)
        rfc_rule = r.get_RFC_rrule()
        if rfc_rule is None:
            return []  # not a recognizable recurrence rule
        rr = rrule.rrulestr(rfc_rule, dtstart=timezone.make_naive(start))
        buckets = []
        for start_date in rr.between(timezone.make_naive(start),
                                     timezone.make_naive(start) + generation_range,
                                     inc=True):
            buckets.append(TimeBucket(start_date=timezone.make_aware(start_date, timezone=start.tzinfo),
                                      duration=self.duration, type=self))
        return buckets


class TimeBucket(models.Model):
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


class TrackingSession(models.Model):
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


class Plan(models.Model):
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


class PlanEntry(models.Model):
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

    class Meta:
        ordering = ["order"]
        verbose_name_plural = "plan entries"

    def __str__(self) -> str:
        return f"[{self.order}] {self.task.header} at {self.start}"
