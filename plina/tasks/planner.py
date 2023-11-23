from typing import List
from tasks.models import Project, Task
from datetime import timedelta


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


def plan_untimed_tasks():
    pass
