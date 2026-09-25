"""UI-1: every Project becomes a top-level task; its tasks become children.

The project's id is reused for the new task, so ids the frontend already
knows (``project_id`` on tasks, ``/api/projects/``) stay valid. The new
task's estimate is the sum of its parts (unestimated parts count with the
1h default), so migrating neither creates a Rest nor an over-budget
warning. Reversing turns every top-level task with children back into a
Project (only the first level; deeper nesting has no Project equivalent).
"""
from datetime import timedelta

from django.db import migrations
from django.utils import timezone

DEFAULT_ESTIMATE = timedelta(hours=1)


def projects_to_tree(apps, schema_editor):
    Project = apps.get_model("tasks", "Project")
    Task = apps.get_model("tasks", "Task")
    Item = apps.get_model("tasks", "ProjectTaskItem")
    Change = apps.get_model("tasks", "TaskEstimateChange")

    projects = list(Project.objects.order_by("order", "name"))
    project_task_ids = set(Item.objects.values_list("task_id", flat=True))
    now = timezone.now()

    for position, project in enumerate(projects):
        items = list(Item.objects.filter(project=project).order_by("order").select_related("task"))
        estimate = sum((item.task.duration or DEFAULT_ESTIMATE for item in items), timedelta(0))
        root = Task.objects.create(
            id=project.id, header=project.name[:1024], description=project.description,
            priority=project.priority, color=project.color, order=position,
            duration=estimate if items else None,
        )
        root.tags.set(project.tags.all())
        Change.objects.create(task=root, old_duration=None, new_duration=root.duration,
                              changed_at=now, reason="migrated")
        for child_order, item in enumerate(items):
            Task.objects.filter(id=item.task_id).update(parent=root, order=child_order)

    loose = Task.objects.filter(parent=None).exclude(id__in=[p.id for p in projects])
    for offset, task in enumerate(loose.exclude(id__in=project_task_ids).order_by("header")):
        Task.objects.filter(id=task.id).update(order=len(projects) + offset)

    Item.objects.all().delete()
    Project.objects.all().delete()


def tree_to_projects(apps, schema_editor):
    Project = apps.get_model("tasks", "Project")
    Task = apps.get_model("tasks", "Task")
    Item = apps.get_model("tasks", "ProjectTaskItem")

    roots = Task.objects.filter(parent=None, children__isnull=False).distinct().order_by("order")
    for position, root in enumerate(roots):
        project = Project.objects.create(
            id=root.id, name=root.header[:512], description=root.description,
            priority=root.priority, color=root.color, order=position,
        )
        project.tags.set(root.tags.all())
        for child_order, child in enumerate(Task.objects.filter(parent=root).order_by("order")):
            Item.objects.create(project=project, task=child, order=child_order)
        Task.objects.filter(parent=root).update(parent=None)
        root.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0011_task_tree"),
    ]

    operations = [
        migrations.RunPython(projects_to_tree, tree_to_projects),
    ]
