from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Task, Project, Tag, TimeBucket, TaskDependency, Plan
from .serializers import (TaskSerializer, ProjectSerializer, TagSerializer,
                          TimeBucketSerializer, TaskDependencySerializer)

class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def _tracking_response(self, task, extra=None):
        payload = {"task": TaskSerializer(task).data}
        if extra:
            payload.update(extra)
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="track/start")
    def track_start(self, request, pk=None):
        from tasks.services.tracking import TrackingError, start_tracking
        task = self.get_object()
        try:
            start_tracking(task)
        except TrackingError as error:
            return Response(error.payload, status=error.status)
        task.refresh_from_db()
        return self._tracking_response(task)

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
            task, alternatives, buckets = complete_task(task)
        except TrackingError as error:
            return Response(error.payload, status=error.status)
        serialized = serialize_alternatives(
            alternatives, buckets,
            plan_ids=[alternative.plan_id for alternative in alternatives],
        ) if alternatives else []
        return self._tracking_response(task, extra={"alternatives": serialized})

class DependencyViewSet(mixins.ListModelMixin,
                        mixins.RetrieveModelMixin,
                        mixins.CreateModelMixin,
                        mixins.DestroyModelMixin,
                        viewsets.GenericViewSet):
    """Dependencies are edges: they are created and deleted, never edited."""
    queryset = TaskDependency.objects.all()
    serializer_class = TaskDependencySerializer

class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer

class TimeBucketViewSet(viewsets.ModelViewSet):
    queryset = TimeBucket.objects.all()
    serializer_class = TimeBucketSerializer

from rest_framework.views import APIView
from rest_framework.response import Response
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from tasks.services.planner_service import build_planning_tasks, rank_tasks, allocate_tasks, UNBUCKETED
from tasks.services.bucket_service import gather_time_buckets
from tasks.models import Task, TimeBucket, TaskDependency, Plan

def _serialize_item(item):
    return {
        "task_id": item.task.id,
        "header": item.task.header,
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
        "header": entry.task.header,
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
        return Response({
            "accepted_plan_id": plan.id,
            "appointments": [_serialize_entry(e) for e in appointments],
            "buckets": [
                {
                    "id": bucket.id,
                    "start_date": bucket.start_date,
                    "end_date": bucket.end_date,
                    "type_name": bucket.type.name,
                    "hex_color": bucket.type.hex_color,
                    "items": [
                        _serialize_entry(e)
                        for e in sorted(bucket_entries, key=lambda e: e.start)
                    ],
                }
                for bucket, bucket_entries in sorted(
                    by_bucket.items(), key=lambda pair: pair[0].start_date
                )
            ],
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
        edges = TaskDependency.objects.values_list("predecessor_id", "successor_id")

        plan = allocate_tasks(buckets, ranked_tasks, edges)

        return Response({
            "accepted_plan_id": None,
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
                    "hex_color": bucket.type.hex_color,
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
        edges = list(
            TaskDependency.objects.values_list("predecessor_id", "successor_id")
        )
        return generate_alternatives(snapshots, buckets, edges, now), buckets

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
    from tasks.models import Project

    project_names = {
    project.id: project.name for project in Project.objects.all()
    }
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
