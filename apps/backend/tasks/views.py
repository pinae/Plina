from datetime import timedelta
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response

from tasks.models import Task, TaskDependency
from tasks.services.bucket_service import gather_time_buckets
from tasks.services.planner_service import allocate_tasks, rank_tasks, build_planning_tasks
from tasks.services.graph import build_dag

# A9: Default planning horizon set to 60 days
PLANNING_HORIZON_DAYS = 60


class PlannerView(APIView):
    def get(self, request):
        now = timezone.now()
        horizon = now + timedelta(days=PLANNING_HORIZON_DAYS)

        # 1. Gather time buckets up to the horizon
        buckets = gather_time_buckets(now, horizon)

        # 2. Fetch unfinished tasks and dependency edges
        tasks = list(Task.objects.filter(completed_at__isnull=True))
        edges = list(TaskDependency.objects.values_list('predecessor_id', 'successor_id'))

        # 3. Snapshot tasks and build the dependency DAG
        snapshots = build_planning_tasks(tasks)
        graph = build_dag(snapshots, edges)

        # 4. Rank and allocate
        ranked_tasks = rank_tasks(snapshots, now)
        plan = allocate_tasks(buckets, ranked_tasks, graph)

        # 5. Serialize for the frontend Calendar / WeekView
        response_data = {}
        for bucket_id, items in plan.items():
            response_data[str(bucket_id)] = [
                {
                    "task_id": str(item.task.id),
                    "header": item.task.header,
                    "start_time": item.start_time.isoformat(),
                    "duration_seconds": item.duration.total_seconds(),
                    "warnings": item.warnings
                } for item in items
            ]

        return Response(response_data)
