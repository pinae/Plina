"""User settings (UI-3): the default duration for unestimated tasks and the
server-synced active project (docs/task-entry-ui.md §2, §3.1, §6.1) — one
row per user, the current one (plina.scoping)."""
from __future__ import annotations

from datetime import timedelta, tzinfo
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from tasks.models import Task, UserSettings

FALLBACK_DEFAULT_DURATION = timedelta(hours=1)


def get_settings() -> UserSettings:
    settings, _ = UserSettings.objects.get_or_create()
    return settings


def default_duration() -> timedelta:
    """The user's default, without creating the row as a side effect."""
    value = UserSettings.objects.values_list("default_duration", flat=True).first()
    return value or FALLBACK_DEFAULT_DURATION


def user_time_zone() -> Optional[tzinfo]:
    """The user's zone, or None to keep the server's (unset or unknown)."""
    name = UserSettings.objects.values_list("time_zone", flat=True).first()
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def is_project(task: Task) -> bool:
    """Projects are top-level tasks; sub-projects are tasks with subtasks."""
    return task.parent_id is None or task.children.exists()


def project_for_tracking(task: Task) -> Task:
    """The project that becomes active when ``task`` is tracked: the nearest
    task, starting with ``task`` and walking up, that is top-level or has
    subtasks (§2)."""
    current = task
    while not is_project(current):
        current = current.parent
    return current


def activate(project: Optional[Task]) -> UserSettings:
    settings = get_settings()
    if settings.active_task_id != (project.id if project else None):
        settings.active_task = project
        settings.save(update_fields=["active_task"])
    return settings


def ensure_active_is_project() -> None:
    """After moves: an active sub-project that lost all its subtasks is a
    single step now — the nearest project above it becomes active."""
    settings = get_settings()
    if settings.active_task is not None and not is_project(settings.active_task):
        activate(project_for_tracking(settings.active_task))


def ensure_active_project_open() -> None:
    """After completions: a completed active project hands over to its
    nearest open ancestor (or none)."""
    settings = get_settings()
    project = settings.active_task
    if project is None or not project.is_done:
        return
    while project is not None and project.is_done:
        project = project.parent
    activate(project)
