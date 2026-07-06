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
