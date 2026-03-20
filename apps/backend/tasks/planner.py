from typing import List
from tasks.models import Project, Task, TimeBucket, TimeBucketType
from datetime import timedelta, datetime


def get_sorted_task_list() -> List[Task]:
    tasks = []
    for project in Project.objects.order_by('-priority').prefetch_related(
            'task_list').prefetch_related('task_list__task').all():
        for project_task in project.tasks:
            tasks.append(project_task)
    for no_project_task in Task.objects.filter(project_item=None).all():
        inserted = False
        for pos, task in enumerate(tasks):
            if task.priority < no_project_task.priority:
                tasks.insert(pos, no_project_task)
                inserted = True
                break
        if not inserted:
            tasks.append(no_project_task)
    return tasks


def split_for_appointments(tasks: List[Task]) -> (List[Task], List[Task]):
    appointments = []
    for i, task in enumerate(tasks):
        if task.duration is not None and task.duration > timedelta(seconds=0) and task.start_date is not None:
            appointments.append(tasks.pop(i))
    return appointments, tasks


def gather_time_buckets(start: datetime, finish: datetime) -> List[TimeBucket]:
    def merge_bucket_lists(prio: List[TimeBucket], additional: List[TimeBucket]) -> List[TimeBucket]:
        for bucket_for_insertion in additional:
            for i, existing_bucket in enumerate(prio):
                if existing_bucket.end_date <= bucket_for_insertion.start_date:
                    continue
                elif existing_bucket.start_date >= bucket_for_insertion.end_date:
                    prio.insert(i, bucket_for_insertion)
                    break
                else:
                    break
        return prio

    buckets = list(TimeBucket.objects.filter(
        start_date__gte=start).filter(
        start_date__lt=finish).order_by('start_date').all())
    for time_bucket_type in TimeBucketType.objects.all():
        generated_buckets = time_bucket_type.generate_buckets(generation_range=finish-start, start=start)
        buckets = merge_bucket_lists(buckets, generated_buckets)
    return buckets


def plan_untimed_tasks():
    pass
