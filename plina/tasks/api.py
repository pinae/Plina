from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Task, Project, Tag, TimeBucket
from .serializers import TaskSerializer, ProjectSerializer, TagSerializer, TimeBucketSerializer

class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

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
from tasks.services.planner_service import rank_tasks, allocate_tasks
from django.utils import timezone
from tasks.models import Task, TimeBucket

class PlannerView(APIView):
    def get(self, request):
        now = timezone.now()
        # Fetch tasks and buckets
        # Logic: Filter tasks that are not done (naive implementation: all tasks for now)
        tasks = list(Task.objects.all())
        ranked_tasks = rank_tasks(tasks, now)
        
        # Create buckets if needed or fetch existing
        # For this demo, we assume buckets exist or we generate some?
        # The prompt says "Planning Tool... automatically plans".
        # We'll just fetch existing buckets from DB for now.
        buckets = list(TimeBucket.objects.filter(start_date__gte=now).all())
        if not buckets:
            # Maybe generate some for demo purposes or return empty
            pass
            
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
