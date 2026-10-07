from rest_framework.views import APIView
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Task, Tag, TimeBucket, TimeBucketType, TaskDependency, Plan
from .services.colors import FALLBACK_COLOR, ensure_auto_colors
from .serializers import (MarkerSerializer, TaskSerializer, TagSerializer,
                          TimeBucketSerializer, TimeBucketTypeSerializer,
                          TaskDependencySerializer)

class RecalculatingModelViewSet(viewsets.ModelViewSet):
    """A7: schedule-relevant CRUD triggers a recalculation of the accepted plan."""

    def perform_create(self, serializer):
        super().perform_create(serializer)
        recalculate_accepted_plan()

    def perform_update(self, serializer):
        super().perform_update(serializer)
        recalculate_accepted_plan()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        recalculate_accepted_plan()


class TaskViewSet(RecalculatingModelViewSet):
    queryset = Task.objects.select_related("series", "deadline_marker") \
        .prefetch_related("calendar_links__subscription")
    serializer_class = TaskSerializer

    def list(self, request, *args, **kwargs):
        catch_up_on_series()
        return super().list(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """A parent needs ``?children=lift`` or ``?children=delete`` (§4.5).
        A recurring task's occurrence goes alone (its date is skipped), or
        with all the others: ``?occurrences=all``."""
        from tasks.services.series import delete_occurrence, delete_series
        from tasks.services.tree import TreeError, delete_task
        task = self.get_object()
        # An imported task (README: Calendar) dismisses its event: the link
        # stays without the task, so the next read does not bring it back.
        if task.series_id is not None:
            delete_series(task) if request.query_params.get("occurrences") == "all" else delete_occurrence(task)
            recalculate_accepted_plan()
            return Response(status=204)
        try:
            delete_task(task, request.query_params.get("children"))
        except TreeError as error:
            return Response(error.payload, status=400)
        ensure_auto_colors()  # lifted subtasks of a project become projects
        recalculate_accepted_plan()
        return Response(status=204)

    def _tracking_response(self, task, extra=None):
        payload = {"task": TaskSerializer(task).data}
        if extra:
            payload.update(extra)
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="track/start")
    def track_start(self, request, pk=None):
        from tasks.services.tracking import TrackingError, start_tracking
        from tasks.serializers import UserSettingsSerializer
        from tasks.services.settings import get_settings
        task = self.get_object()
        try:
            _, stopped = start_tracking(task)
        except TrackingError as error:
            return Response(error.payload, status=error.status)
        task.refresh_from_db()
        return self._tracking_response(task, extra={
            # The task whose session was closed by switching over (UI-3).
            "stopped_task_id": stopped.id if stopped is not None else None,
            "settings": UserSettingsSerializer(get_settings()).data,
        })

    @action(detail=True, methods=["post"], url_path="track/stop")
    def track_stop(self, request, pk=None):
        from tasks.services.tracking import TrackingError, stop_tracking
        task = self.get_object()
        try:
            stop_tracking(task)
        except TrackingError as error:
            return Response(error.payload, status=error.status)
        task.refresh_from_db()
        return self._tracking_response(task)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        from tasks.services.tracking import TrackingError, complete_task
        task = self.get_object()
        try:
            task, auto_completed, alternatives, buckets = complete_task(task)
        except TrackingError as error:
            return Response(error.payload, status=error.status)
        serialized = serialize_alternatives(
            alternatives, buckets,
            plan_ids=[alternative.plan_id for alternative in alternatives],
        ) if alternatives else []
        return self._tracking_response(task, extra={
            "alternatives": serialized,
            # Parents completed because their last open child was (bottom-up).
            "auto_completed": [{"id": t.id, "header": t.header} for t in auto_completed],
        })

    @action(detail=True, methods=["post"])
    def split(self, request, pk=None):
        """The split editor's atomic save (UI-3, §4)."""
        from tasks.serializers import SplitSerializer
        from tasks.services.split import UNSET, SplitError, split_task
        task = self.get_object()
        body = SplitSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            children = split_task(
                task, data["children"], estimate=data.get("estimate", UNSET),
                estimate_reason=data["estimate_reason"], sequential=data["sequential"],
                inherit_tags=data["inherit_tags"], inherit_priority=data["inherit_priority"],
            )
        except SplitError as error:
            return Response(error.payload, status=400)
        ensure_auto_colors()
        recalculate_accepted_plan()
        task.refresh_from_db()
        context = self.get_serializer_context()  # shared: one tree snapshot
        return Response({
            "task": TaskSerializer(task, context=context).data,
            "children": TaskSerializer(children, many=True, context=context).data,
        })

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """Drag and drop in the Tasks tab (T-1): new parent + position."""
        from tasks.serializers import MoveSerializer
        from tasks.services.settings import ensure_active_is_project
        from tasks.services.tree import MoveError, move_task
        task = self.get_object()
        body = MoveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            task = move_task(task, body.validated_data["parent_id"], body.validated_data["index"])
        except MoveError as error:
            return Response(error.payload, status=400)
        ensure_auto_colors()  # moved to the top level
        ensure_active_is_project()
        recalculate_accepted_plan()
        return Response({"task": TaskSerializer(task, context=self.get_serializer_context()).data})

    @action(detail=True, methods=["post"])
    def merge(self, request, pk=None):
        """Merge ``other_id`` into this task (README: Calendar): ``values``
        are the merged fields (as for PATCH); the other task's time,
        dependencies, subtasks and calendar link move over, then it goes."""
        from django.db import transaction
        from tasks.services.merge import MergeError, merge_into, merge_refusal
        kept = self.get_object()
        other = Task.objects.filter(id=request.data.get("other_id")).first() \
            if _is_uuid(request.data.get("other_id")) else None
        if other is None:
            return Response({"detail": "The task to merge is gone. Reload and try again."}, status=400)
        refusal = merge_refusal(kept, other)
        values = dict(request.data.get("values") or {})
        if refusal is None and str(values.get("parent_id")) == str(other.id):
            refusal = f"“{kept.header}” cannot go into “{other.header}”: that one goes in the merge."
        if refusal:
            return Response({"detail": refusal}, status=400)
        for unmerged in ("recurrence", "scope", "calendar_resolved"):
            values.pop(unmerged, None)
        try:
            with transaction.atomic():
                serializer = TaskSerializer(kept, data=values, partial=True, context=self.get_serializer_context())
                serializer.is_valid(raise_exception=True)
                serializer.save()
                notes = merge_into(kept, other)
        except MergeError as error:
            return Response(error.payload, status=400)
        ensure_auto_colors()
        recalculate_accepted_plan()
        kept = self.get_queryset().get(id=kept.id)
        return Response({"task": TaskSerializer(kept, context=self.get_serializer_context()).data, "notes": notes})

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        """Undo a completion (also of auto-completed parents, §4.5)."""
        from tasks.services.completion import CompletionError, reopen
        task = self.get_object()
        try:
            reopened = reopen(task)
        except CompletionError as error:
            return Response(error.payload, status=400)
        recalculate_accepted_plan()
        task.refresh_from_db()
        return self._tracking_response(task, extra={"reopened": [t.id for t in reopened]})

class DependencyViewSet(mixins.ListModelMixin,
                        mixins.RetrieveModelMixin,
                        mixins.CreateModelMixin,
                        mixins.DestroyModelMixin,
                        viewsets.GenericViewSet):
    """Dependencies are edges: they are created and deleted, never edited."""
    queryset = TaskDependency.objects.all()
    serializer_class = TaskDependencySerializer

    def perform_create(self, serializer):
        super().perform_create(serializer)
        recalculate_accepted_plan()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        recalculate_accepted_plan()

def _is_uuid(value) -> bool:
    from uuid import UUID
    try:
        UUID(str(value))
        return True
    except ValueError:
        return False


class MarkerViewSet(RecalculatingModelViewSet):
    """Markers (README: Calendar); ``?from=…&to=…`` lists those overlapping."""
    serializer_class = MarkerSerializer

    def get_queryset(self):
        from django.db.models import DateTimeField, ExpressionWrapper, F
        from django.utils.dateparse import parse_datetime
        from tasks.models import Marker
        markers = Marker.objects.prefetch_related("calendar_links__subscription")
        start = parse_datetime(self.request.query_params.get("from") or "")
        end = parse_datetime(self.request.query_params.get("to") or "")
        if start is not None:
            markers = markers.annotate(end_at=ExpressionWrapper(F("start") + F("duration"),
                                                                output_field=DateTimeField()))
            markers = markers.filter(end_at__gte=start)
        if end is not None:
            markers = markers.filter(start__lte=end)
        return markers

    def perform_update(self, serializer):
        from tasks.services.markers import move_deadlines
        marker = serializer.save()
        move_deadlines(marker)  # named deadlines move along
        recalculate_accepted_plan()

    @action(detail=True, methods=["post"])
    def convert(self, request, pk=None):
        """Make the marker a special bucket (README: Calendar): the body as
        for a bucket type; the frame defaults to the marker's time."""
        from django.db import transaction
        from tasks.services.colors import ensure_bucket_type_colors
        from tasks.services.markers import make_special_bucket
        marker = self.get_object()
        data = {"name": marker.title, "special_start": marker.start, "special_end": marker.end,
                **request.data}
        serializer = TimeBucketTypeSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            bucket_type = serializer.save()
            make_special_bucket(marker, bucket_type)
        ensure_bucket_type_colors()
        recalculate_accepted_plan()
        bucket_type.refresh_from_db()
        return Response(TimeBucketTypeSerializer(bucket_type).data, status=201)


class CalendarViewSet(viewsets.ModelViewSet):
    """The calendars Plina reads (README: Calendar)."""

    def get_queryset(self):
        from tasks.models import CalendarSubscription
        return CalendarSubscription.objects.order_by("name")

    def get_serializer_class(self):
        from tasks.serializers import CalendarSubscriptionSerializer
        return CalendarSubscriptionSerializer

    def perform_create(self, serializer):
        self._read(serializer.save())  # says at once whether the address works

    def perform_update(self, serializer):
        url_changed = "url" in serializer.validated_data
        subscription = serializer.save()
        if url_changed:
            self._read(subscription)

    def perform_destroy(self, instance):
        from tasks.services.calendar_sync import unsubscribe
        unsubscribe(instance)
        recalculate_accepted_plan()

    def _read(self, subscription):
        from django.utils import timezone as tz
        from tasks.services.calendar_sync import CalendarError, sync
        now = tz.now()
        try:
            sync(subscription, now)
            subscription.last_synced_at, subscription.last_error = now, ""
        except CalendarError as error:
            subscription.last_error = str(error)
        subscription.last_attempt_at = now
        subscription.save(update_fields=["last_synced_at", "last_error", "last_attempt_at"])
        recalculate_accepted_plan()

    @action(detail=False, methods=["post"], url_path="sync")
    def sync_all(self, request):
        """Read the calendars not read for a while (``force``: all now). The
        app calls this when it opens and every few minutes."""
        from tasks.services.calendar_sync import sync_due
        changed = sync_due(force=bool(request.data.get("force")))
        if changed:
            recalculate_accepted_plan()
        serializer = self.get_serializer_class()
        return Response({"changed": changed, "calendars": serializer(self.get_queryset(), many=True).data})


class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer

class TimeBucketTypeViewSet(RecalculatingModelViewSet):
    queryset = TimeBucketType.objects.all()
    serializer_class = TimeBucketTypeSerializer


class SettingsView(APIView):
    """GET/PATCH the user settings (UI-3)."""

    def get(self, request):
        from .serializers import UserSettingsSerializer
        from .services.settings import get_settings
        return Response(UserSettingsSerializer(get_settings()).data)

    def patch(self, request):
        from .serializers import UserSettingsSerializer
        from .services.settings import get_settings, user_time_zone
        settings = get_settings()
        old_default, old_zone = settings.default_duration, settings.time_zone
        serializer = UserSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if settings.default_duration != old_default or settings.time_zone != old_zone:
            # Unestimated tasks change size / recurring buckets move (A7).
            with timezone.override(user_time_zone() or timezone.get_default_timezone()):
                recalculate_accepted_plan()
        return Response(serializer.data)


class RecurrencePreviewView(APIView):
    """Live preview for the Repeats field of the task form (``recurrence``,
    from ``start``) and the bucket-type form (``start_times``): the rule in
    words and its next occurrences, or the parser error explaining why there
    are none."""

    def post(self, request):
        from django.utils.dateparse import parse_datetime
        from .services import recurrence
        from .services.bucket_service import RecurrenceError, preview_occurrences
        if "recurrence" in request.data:
            from .services.series import preview
            start = request.data.get("start")
            start = parse_datetime(start) if isinstance(start, str) and start else None
            try:
                description, occurrences = preview(str(request.data["recurrence"]), start)
            except recurrence.RecurrenceError as error:
                return Response({"detail": str(error)}, status=400)
            if not occurrences:
                return Response({"detail": f"“{request.data['recurrence']}” does not happen any more."}, status=400)
        else:
            text = request.data.get("start_times", "")
            try:
                occurrences = preview_occurrences(text)
            except RecurrenceError as error:
                return Response({"detail": str(error)}, status=400)
            description = recurrence.describe(recurrence.parse_rule(text))
        return Response({"description": description, "occurrences": [occ.isoformat() for occ in occurrences]})


class TimeSheetView(APIView):
    """The time sheet (README: Time sheet): ``?from=2026-10-01&to=2026-10-31``
    (both days included), by default this month — per day the begin and end
    of work, the pauses and the tasks counted."""

    def get(self, request):
        import calendar
        from datetime import date
        from .services import timesheet
        today = timezone.localdate()
        try:
            first = date.fromisoformat(request.query_params.get("from") or today.replace(day=1).isoformat())
            last = date.fromisoformat(request.query_params.get("to") or first.replace(
                day=calendar.monthrange(first.year, first.month)[1]).isoformat())
        except ValueError:
            return Response({"detail": "Give the days like 2026-10-01."}, status=400)
        if last < first:
            return Response({"detail": "The last day is before the first."}, status=400)
        if (last - first).days >= timesheet.MAX_DAYS:
            return Response({"detail": f"At most {timesheet.MAX_DAYS} days at once."}, status=400)
        moment = serializers.DateTimeField().to_representation
        return Response({
            "from": first.isoformat(), "to": last.isoformat(),
            "work_tags": timesheet.WORK_TAGS, "pause_tags": timesheet.PAUSE_TAGS,
            "days": [{
                "date": day.date.isoformat(), "begin": moment(day.begin), "end": moment(day.end),
                "running": day.running, "pause_seconds": day.pause_seconds, "working_seconds": day.working_seconds,
                "entries": [{
                    "task_id": entry.task_id, "header": entry.header, "tags": entry.tags, "kind": entry.kind,
                    "seconds": entry.seconds, "running": entry.running,
                } for entry in day.entries],
            } for day in timesheet.time_sheet(first, last)],
        })


class TimeBucketViewSet(RecalculatingModelViewSet):
    queryset = TimeBucket.objects.all()
    serializer_class = TimeBucketSerializer

from rest_framework.views import APIView
from rest_framework.response import Response
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from tasks.services.planner_service import (build_planning_tasks, rank_tasks, allocate_tasks,
                                            planning_edges, UNBUCKETED)
from tasks.services.bucket_service import gather_time_buckets
from tasks.services.plan_store import recalculate_accepted_plan
from tasks.models import Task, TimeBucket, TaskDependency, Plan


def catch_up_on_series():
    """Recurring tasks (services.series): make the occurrences that are due
    before tasks or plans are shown; the accepted plan takes them in."""
    from tasks.services.series import keep_up
    if keep_up():
        recalculate_accepted_plan()

def _task_colors():
    """Color each task shows (§4.4), from one snapshot of the tree; a Rest
    unit is planned under its parent's id and shows the parent's color."""
    from tasks.services.tree import TreeIndex
    tree = TreeIndex.load()
    return lambda task_id: tree.effective_color(task_id) if task_id in tree.nodes else FALLBACK_COLOR


def _serialize_item(item, color_of):
    return {
        "task_id": item.task.id,
        "header": item.header,
        "is_rest": item.is_rest,
        "start_time": item.start_time,
        "duration": item.duration.total_seconds(),
        "warnings": item.warnings,
        "is_fixed": item.task.is_fixed,
        "is_appointment": item.task.is_appointment,
        "hex_color": color_of(item.task.id),
    }

def _entry_warnings(entry):
    deadline = entry.task.latest_finish_date
    if deadline and entry.start + entry.duration > deadline:
        return ["Deadline exceeded"]
    return []


def _serialize_entry(entry, color_of):
    return {
        "task_id": entry.task.id,
        "header": f"Rest of {entry.task.header}" if entry.is_rest else entry.task.header,
        "is_rest": entry.is_rest,
        "start_time": entry.start,
        "duration": entry.duration.total_seconds(),
        "warnings": _entry_warnings(entry),
        "is_fixed": entry.task.is_fixed,
        "is_appointment": entry.task.is_appointment,
        "hex_color": color_of(entry.task.id),
        "order": entry.order,
    }


class PlannerView(APIView):
    def _accepted_plan_response(self, plan):
        entries = list(plan.entries.select_related("task", "bucket__type").all())
        color_of = _task_colors()
        appointments = sorted(
            (e for e in entries if e.bucket is None and e.task.is_appointment),
            key=lambda e: e.start,
        )
        by_bucket = {}
        for entry in entries:
            if entry.bucket is not None:
                by_bucket.setdefault(entry.bucket, []).append(entry)
        # A9: also expose the *empty* upcoming buckets so the client can
        # find the first free day; entry-buckets keep their items.
        horizon = timedelta(days=settings.PLANNING_HORIZON_DAYS)
        now = timezone.now()
        occupied_ids = {bucket.id for bucket in by_bucket}
        free_buckets = [
            {
                "id": bucket.id,
                "start_date": bucket.start_date,
                "end_date": bucket.end_date,
                "type_name": bucket.type.name,
                "type_id": bucket.type_id,
                "hex_color": bucket.type.hex_color,
                "persisted": not bucket._state.adding,
                "items": [],
            }
            for bucket in gather_time_buckets(now, now + horizon)
            if bucket.id not in occupied_ids
        ]

        return Response({
            "accepted_plan_id": plan.id,
            "warnings": plan.warnings,
            "appointments": [_serialize_entry(e, color_of) for e in appointments],
            "buckets": [
                {
                    "id": bucket.id,
                    "start_date": bucket.start_date,
                    "end_date": bucket.end_date,
                    "type_name": bucket.type.name,
                    "type_id": bucket.type_id,
                    "hex_color": bucket.type.hex_color,
                    "persisted": True,
                    "items": [
                        _serialize_entry(e, color_of)
                        for e in sorted(bucket_entries, key=lambda e: e.start)
                    ],
                }
                for bucket, bucket_entries in sorted(
                    by_bucket.items(), key=lambda pair: pair[0].start_date
                )
            ] + sorted(free_buckets, key=lambda b: b["start_date"]),
        })

    def get(self, request):
        catch_up_on_series()
        accepted = Plan.objects.filter(is_accepted=True).first()
        if accepted is not None:
            return self._accepted_plan_response(accepted)

        now = timezone.now()
        snapshots = build_planning_tasks(
            Task.objects.filter(completed_at=None).prefetch_related("tags")
        )
        ranked_tasks = rank_tasks(snapshots, now)

        horizon = timedelta(days=settings.PLANNING_HORIZON_DAYS)
        buckets = gather_time_buckets(now, now + horizon)
        plan = allocate_tasks(buckets, ranked_tasks, planning_edges(snapshots))
        color_of = _task_colors()

        return Response({
            "accepted_plan_id": None,
            "warnings": [],
            "appointments": [
                _serialize_item(item, color_of)
                for item in sorted(plan[UNBUCKETED], key=lambda i: i.start_time)
            ],
            "buckets": [
                {
                    "id": bucket.id,
                    "start_date": bucket.start_date,
                    "end_date": bucket.end_date,
                    "type_name": bucket.type.name,
                    "type_id": bucket.type_id,
                    "hex_color": bucket.type.hex_color,
                    "persisted": not bucket._state.adding,
                    "items": [_serialize_item(item, color_of) for item in plan[bucket.id]],
                }
                for bucket in buckets
            ],
        })


class PlanAlternativesView(APIView):
    """Compute up to MAX_PLAN_ALTERNATIVES meaningfully different valid plans.

    Persistence and acceptance of a chosen plan arrive with WP-5; until then
    this endpoint is a pure computation.
    """

    def _compute(self):
        from tasks.services.alternatives import generate_alternatives

        catch_up_on_series()
        now = timezone.now()
        snapshots = build_planning_tasks(
            Task.objects.filter(completed_at=None).prefetch_related("tags")
        )
        horizon = timedelta(days=settings.PLANNING_HORIZON_DAYS)
        buckets = gather_time_buckets(now, now + horizon)
        return generate_alternatives(snapshots, buckets, planning_edges(snapshots), now), buckets

    def get(self, request):
        """Preview: compute without storing."""
        alternatives, buckets = self._compute()
        return self._respond(alternatives, buckets, plan_ids=None)

    def post(self, request):
        """Compute, store as candidate plans (replacing unaccepted ones) and
        return them with their ids for the accept flow (WP-5)."""
        from tasks.services.plan_store import store_alternatives
        alternatives, buckets = self._compute()
        plans = store_alternatives(alternatives, buckets)
        return self._respond(alternatives, buckets, plan_ids=[plan.id for plan in plans])

    def _respond(self, alternatives, buckets, plan_ids):
        payload = serialize_alternatives(alternatives, buckets, plan_ids)
        return Response({"alternatives": payload})


def serialize_alternatives(alternatives, buckets, plan_ids=None):
    project_names = dict(Task.objects.filter(parent=None).values_list("id", "header"))
    buckets_by_id = {bucket.id: bucket for bucket in buckets}
    color_of = _task_colors()

    def serialize_alternative(alternative):
        planned_buckets = [
            {
                "id": bucket_id,
                "start_date": buckets_by_id[bucket_id].start_date,
                "end_date": buckets_by_id[bucket_id].end_date,
                "type_name": buckets_by_id[bucket_id].type.name,
                "hex_color": buckets_by_id[bucket_id].type.hex_color,
                "items": [_serialize_item(item, color_of) for item in items],
            }
            for bucket_id, items in alternative.plan.items()
            if bucket_id is not UNBUCKETED and items
        ]
        planned_buckets.sort(key=lambda bucket: bucket["start_date"])
        metrics = alternative.metrics
        return {
            "label": alternative.label,
            "feasible": alternative.feasible,
            "warnings": [
                {
                    "task_id": warning.task_id,
                    "header": warning.header,
                    "kind": warning.kind,
                    "deadline": warning.deadline,
                    "projected_finish": warning.projected_finish,
                }
                for warning in alternative.warnings
            ],
            "metrics": {
                "min_slack_seconds": (
                    metrics.min_slack.total_seconds()
                    if metrics.min_slack is not None else None
                ),
                "context_switches": metrics.context_switches,
                "priority_earliness_hours": metrics.priority_earliness_hours,
                "project_finishes": [
                    {
                        "project_id": project_id,
                        "name": project_names.get(project_id, ""),
                        "finish": finish,
                    }
                    for project_id, finish in sorted(
                        metrics.project_finishes.items(),
                        key=lambda pair: pair[1],
                    )
                ],
            },
            "appointments": [
                _serialize_item(item, color_of)
                for item in sorted(
                    alternative.plan[UNBUCKETED], key=lambda i: i.start_time
                )
            ],
            "buckets": planned_buckets,
        }

    payload = [serialize_alternative(a) for a in alternatives]
    if plan_ids is not None:
        for entry, plan_id in zip(payload, plan_ids):
            entry["id"] = plan_id
    return payload


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = ['id', 'label', 'is_accepted', 'feasible', 'created_at',
                  'metrics', 'warnings']


class PlanViewSet(mixins.ListModelMixin,
                  mixins.RetrieveModelMixin,
                  viewsets.GenericViewSet):
    """Stored plans (candidates + the accepted one).  Plans are produced by
    POST /api/plan/alternatives/ and chosen via the accept action; they are
    never edited directly."""
    queryset = Plan.objects.all()
    serializer_class = PlanSerializer

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        from tasks.services.plan_store import accept_plan
        plan = accept_plan(self.get_object())
        return Response(PlanSerializer(plan).data)
