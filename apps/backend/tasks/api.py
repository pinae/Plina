from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Task, Project, Tag, TimeBucket, TaskDependency
from .serializers import (TaskSerializer, ProjectSerializer, TagSerializer,
                          TimeBucketSerializer, TaskDependencySerializer)

class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

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
from tasks.models import Task, TimeBucket

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

class PlannerView(APIView):
    def get(self, request):
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

    def get(self, request):
        from tasks.models import Project
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

        alternatives = generate_alternatives(snapshots, buckets, edges, now)

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

        return Response({
            "alternatives": [
                serialize_alternative(alternative) for alternative in alternatives
            ],
        })
