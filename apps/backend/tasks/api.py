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
from tasks.services.planner_service import build_planning_tasks, rank_tasks, allocate_tasks
from django.utils import timezone
from tasks.models import Task, TimeBucket

class PlannerView(APIView):
    def get(self, request):
        now = timezone.now()
        snapshots = build_planning_tasks(
            Task.objects.filter(completed_at=None).prefetch_related("tags")
        )
        ranked_tasks = rank_tasks(snapshots, now)

        # NOTE (WP-3): will use services.bucket_service.gather_time_buckets over
        # the planning horizon; for now only persisted buckets are considered.
        buckets = list(TimeBucket.objects.filter(start_date__gte=now).all())

        plan = allocate_tasks(buckets, ranked_tasks)
        
        # Serialize Plan
        # Structure: key is bucket_id, value is list of items
        serialized_plan = {}
        for bucket_id, items in plan.items():
            serialized_plan[bucket_id] = [
                {
                    "task_id": item.task.id,
                    "header": item.task.header,
                    "start_time": item.start_time,
                    "duration": item.duration.total_seconds(),
                    "warnings": item.warnings,
                    "is_fixed": item.task.is_fixed,
                    "hex_color": item.task.hex_color
                }
                for item in items
            ]
            
        return Response(serialized_plan)
