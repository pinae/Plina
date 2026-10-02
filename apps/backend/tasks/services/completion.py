"""Completing and reopening tasks in the tree (UI-2, docs/task-entry-ui.md §4.5).

* A parent completes automatically when its last open child is completed;
  its Rest is dropped (and recorded in its completion snapshot). This
  cascades upwards.
* A parent with open subtasks cannot be completed directly — completing it
  would silently drop planned work.
* Reopening a task reopens its completed ancestors too (an open task
  cannot live inside a completed one); its children stay as they are.
"""
from __future__ import annotations

from datetime import datetime
from typing import List

from tasks.models import Task, TrackingSession
from tasks.services.estimates import clear_completion_snapshot, write_completion_snapshot


class CompletionError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.payload = {"detail": detail}


def open_subtask_count(task: Task) -> int:
    from tasks.services.tree import TreeIndex
    tree = TreeIndex.load()
    descendants = tree.descendant_ids(task.id)
    return Task.objects.filter(id__in=descendants, completed_at=None).count()


def ensure_completable(task: Task) -> None:
    count = open_subtask_count(task)
    if count:
        noun = "subtask" if count == 1 else "subtasks"
        raise CompletionError(
            f"“{task.header}” still has {count} open {noun}. Complete or delete "
            f"{'it' if count == 1 else 'them'} first — “{task.header}” then completes "
            "automatically."
        )


def _close_open_session(task: Task, now: datetime) -> None:
    session = TrackingSession.objects.filter(task=task, end=None).first()
    if session is not None:
        session.end = now
        session.save(update_fields=["end"])
        task.time_spent += session.end - session.start


def complete_finished_ancestors(task: Task, now: datetime) -> List[Task]:
    """Complete every ancestor whose subtasks are now all done, bottom-up."""
    completed = []
    parent = task.parent
    while parent is not None and not parent.is_done:
        if Task.objects.filter(parent=parent, completed_at=None).exists():
            break
        _close_open_session(parent, now)
        parent.completed_at = now
        parent.save(update_fields=["completed_at", "time_spent"])
        write_completion_snapshot(parent)
        completed.append(parent)
        parent = parent.parent
    return completed


def reopen(task: Task) -> List[Task]:
    """Reopen ``task`` and its completed ancestors; returns them bottom-up."""
    if not task.is_done:
        raise CompletionError(f"“{task.header}” is not completed.")
    reopened = []
    current = task
    while current is not None and current.is_done:
        current.completed_at = None
        current.save(update_fields=["completed_at"])
        clear_completion_snapshot(current)
        reopened.append(current)
        current = current.parent
    return reopened
