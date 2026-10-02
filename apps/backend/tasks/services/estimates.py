"""Estimate history and completion snapshots (§4.6 of docs/task-entry-ui.md).

Estimates and tracked time are kept even when they disagree, so projects
can be analyzed later: every estimate change is recorded, and completing a
task freezes its estimates and tracked time.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from django.utils import timezone

from tasks.models import Task, TaskEstimateChange
from tasks.services.tree import TreeIndex


def record_estimate_change(task: Task, old: Optional[timedelta], new: Optional[timedelta],
                           reason: str, at: Optional[datetime] = None) -> Optional[TaskEstimateChange]:
    """Store one estimate change. ``created`` is always stored (it holds the
    first estimate, even an empty one); other reasons only on a real change."""
    if reason != "created" and old == new:
        return None
    return TaskEstimateChange.objects.create(
        task=task, old_duration=old, new_duration=new, reason=reason,
        changed_at=at or timezone.now(),
    )


def write_completion_snapshot(task: Task, index: Optional[TreeIndex] = None) -> None:
    index = index or TreeIndex.load()
    first = task.estimate_changes.order_by("changed_at").first()
    task.completion_estimate = task.duration
    task.completion_first_estimate = first.new_duration if first else task.duration
    task.completion_time_spent = task.time_spent
    task.completion_subtree_time_spent = index.subtree_time_spent(task.id)
    task.completion_dropped_rest = index.rest(task.id)
    task.save(update_fields=SNAPSHOT_FIELDS)


def clear_completion_snapshot(task: Task) -> None:
    for field in SNAPSHOT_FIELDS:
        setattr(task, field, None)
    task.save(update_fields=SNAPSHOT_FIELDS)


SNAPSHOT_FIELDS = [
    "completion_estimate", "completion_first_estimate", "completion_time_spent",
    "completion_subtree_time_spent", "completion_dropped_rest",
]
