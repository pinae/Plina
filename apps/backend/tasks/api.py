from rest_framework.views import APIView
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Task, Tag, TimeBucket, TimeBucketType, TaskDependency, Plan
from .serializers import (TaskSerializer, TagSerializer,
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
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def destroy(self, request, *args, **kwargs):
        """A parent needs ``?children=lift`` or ``?children=delete`` (§4.5)."""
        from tasks.services.tree import TreeError, delete_task
        task = self.get_object()
        try:
            delete_task(task, request.query_params.get("children"))
        except TreeError as error:
            return Response(error.payload, status=400)
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
        recalculate_accepted_plan()
        task.refresh_from_db()
        context = self.get_serializer_context()  # shared: one tree snapshot
        return Response({
            "task": TaskSerializer(task, context=context).data,
            "children": TaskSerializer(children, many=True, context=context).data,
        })

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
        from .services.settings import get_settings
        settings = get_settings()
        old_default = settings.default_duration
        serializer = UserSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if settings.default_duration != old_default:
            recalculate_accepted_plan()  # unestimated tasks change size (A7)
        return Response(serializer.data)


class RecurrencePreviewView(APIView):
    """Live preview for the bucket-type form: the next occurrences of a
    recurrence string, or the parser error explaining why there are none."""

    def post(self, request):
        from .services.bucket_service import RecurrenceError, preview_occurrences
        try:
            occurrences = preview_occurrences(request.data.get("start_times", ""))
        except RecurrenceError as error:
            return Response({"detail": str(error)}, status=400)
        return Response({"occurrences": [occ.isoformat() for occ in occurrences]})


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

def _serialize_item(item):
    return {
        "task_id": item.task.id,
        "header": item.header,
        "is_rest": item.is_rest,
        "start_time": item.start_time,
        "duration": item.duration.total_seconds(),
        "warnings": item.warnings,
        "is_fixed": item.task.is_fixed,
        "is_appointment": item.task.is_appointment,
        "hex_color": item.task.hex_color,
    }

def _entry_warnings(entry):
    deadline = entry.task.latest_finish_date
    if deadline and entry.start + entry.duration > deadline:
        return ["Deadline exceeded"]
    return []


def _serialize_entry(entry):
    return {
        "task_id": entry.task.id,
        "header": f"Rest of {entry.task.header}" if entry.is_rest else entry.task.header,
        "is_rest": entry.is_rest,
        "start_time": entry.start,
        "duration": entry.duration.total_seconds(),
        "warnings": _entry_warnings(entry),
        "is_fixed": entry.task.is_fixed,
        "is_appointment": entry.task.is_appointment,
        "hex_color": entry.task.hex_color,
        "order": entry.order,
    }


class PlannerView(APIView):
    def _accepted_plan_response(self, plan):
        entries = list(plan.entries.select_related("task", "bucket__type").all())
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
            "appointments": [_serialize_entry(e) for e in appointments],
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
                        _serialize_entry(e)
                        for e in sorted(bucket_entries, key=lambda e: e.start)
                    ],
                }
                for bucket, bucket_entries in sorted(
                    by_bucket.items(), key=lambda pair: pair[0].start_date
                )
            ] + sorted(free_buckets, key=lambda b: b["start_date"]),
        })

    def get(self, request):
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

        return Response({
            "accepted_plan_id": None,
            "warnings": [],
            "appointments": [
                _serialize_item(item)
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
                    "items": [_serialize_item(item) for item in plan[bucket.id]],
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

    def serialize_alternative(alternative):
        planned_buckets = [
            {
                "id": bucket_id,
                "start_date": buckets_by_id[bucket_id].start_date,
                "end_date": buckets_by_id[bucket_id].end_date,
                "type_name": buckets_by_id[bucket_id].type.name,
                "hex_color": buckets_by_id[bucket_id].type.hex_color,
                "items": [_serialize_item(item) for item in items],
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
                _serialize_item(item)
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
