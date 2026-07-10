"""Persistence of plans (WP-5, A4/A8).

* :func:`store_alternatives` — replace unaccepted candidates with a fresh set.
* :func:`accept_plan` — mark the chosen plan, materialize the generated
  buckets it uses (A8), delete every other plan.  Accepting never fixes tasks.
* :func:`recalculate_accepted_plan` — reflow all fluid entries with the
  plan's stored generation config; entries of appointments and anchored fixed
  tasks stay untouched (byte-identical).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Optional
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from tasks.models import Plan, PlanEntry, Task, TimeBucket
from tasks.services.alternatives import (PlanAlternative, _apply_focus,
                                         _evaluate, _preset_config,
                                         _preset_ranking)
from tasks.services.bucket_service import gather_time_buckets
from tasks.services.planner_service import (UNBUCKETED, PlanItem,
                                            allocate_tasks,
                                            build_planning_tasks)


def _is_persisted(bucket: TimeBucket) -> bool:
    return not bucket._state.adding


def _metrics_json(metrics) -> dict:
    return {
        "min_slack_seconds": (
            metrics.min_slack.total_seconds()
            if metrics.min_slack is not None else None
        ),
        "context_switches": metrics.context_switches,
        "priority_earliness_hours": metrics.priority_earliness_hours,
        "project_finishes": [
            {"project_id": str(project_id), "finish": finish.isoformat()}
            for project_id, finish in metrics.project_finishes.items()
        ],
    }


def _warnings_json(warnings) -> list:
    return [
        {
            "task_id": str(warning.task_id),
            "header": warning.header,
            "kind": warning.kind,
            "deadline": warning.deadline.isoformat() if warning.deadline else None,
            "projected_finish": (
                warning.projected_finish.isoformat()
                if warning.projected_finish else None
            ),
        }
        for warning in warnings
    ]


def _chronological_items(plan_dict: Dict[object, List[PlanItem]]):
    """All (bucket_id, item) pairs sorted by start time; UNBUCKETED included."""
    pairs = [
        (bucket_id, item)
        for bucket_id, items in plan_dict.items()
        for item in items
    ]
    return sorted(pairs, key=lambda pair: pair[1].start_time)


@transaction.atomic
def store_alternatives(alternatives: List[PlanAlternative],
                       buckets: List[TimeBucket]) -> List[Plan]:
    """Persist a fresh candidate set, replacing all unaccepted plans."""
    Plan.objects.filter(is_accepted=False).delete()

    bucket_by_id = {bucket.id: bucket for bucket in buckets}
    plans: List[Plan] = []
    for alternative in alternatives:
        snapshot: Dict[str, dict] = {}
        entries: List[PlanEntry] = []
        plan = Plan(
            label=alternative.label,
            feasible=alternative.feasible,
            config={
                "preset": alternative.preset,
                "focus_task_ids": [str(t) for t in alternative.focus_task_ids],
            },
            metrics=_metrics_json(alternative.metrics),
            warnings=_warnings_json(alternative.warnings),
        )
        for order, (bucket_id, item) in enumerate(_chronological_items(alternative.plan)):
            entry = PlanEntry(
                plan=plan, task=item.task, start=item.start_time,
                duration=item.duration, order=order,
            )
            if bucket_id is not UNBUCKETED:
                bucket = bucket_by_id[bucket_id]
                if _is_persisted(bucket):
                    entry.bucket = bucket
                else:
                    entry.bucket_key = bucket.id
                    snapshot[str(bucket.id)] = {
                        "start_date": bucket.start_date.isoformat(),
                        "duration_seconds": bucket.duration.total_seconds(),
                        "type_id": bucket.type_id,
                    }
            entries.append(entry)
        plan.buckets_snapshot = snapshot
        plan.save()
        PlanEntry.objects.bulk_create(entries)
        plans.append(plan)
    return plans


@transaction.atomic
def accept_plan(plan: Plan) -> Plan:
    """Mark ``plan`` accepted, materialize its generated buckets (A8),
    delete every other plan.  Deliberately does NOT fix any task."""
    to_link = list(plan.entries.filter(bucket=None, bucket_key__isnull=False))
    for entry in to_link:
        meta = plan.buckets_snapshot[str(entry.bucket_key)]
        bucket, _ = TimeBucket.objects.get_or_create(
            id=entry.bucket_key,
            defaults={
                "start_date": datetime.fromisoformat(meta["start_date"]),
                "duration": timedelta(seconds=meta["duration_seconds"]),
                "type_id": meta["type_id"],
            },
        )
        entry.bucket = bucket
    PlanEntry.objects.bulk_update(to_link, ["bucket"])

    plan.is_accepted = True
    plan.save(update_fields=["is_accepted"])
    Plan.objects.exclude(pk=plan.pk).delete()
    return plan


def _anchored_task_ids() -> set:
    """Tasks whose plan entries must never be rewritten by a recalculation:
    appointments and anchored fixed tasks (A8)."""
    return set(
        Task.objects.filter(is_appointment=True, start_date__isnull=False)
        .values_list("id", flat=True)
    ) | set(
        Task.objects.filter(is_fixed=True, start_date__isnull=False)
        .values_list("id", flat=True)
    )


@transaction.atomic
def recalculate_accepted_plan(now: Optional[datetime] = None) -> Optional[Plan]:
    """Reflow the accepted plan's fluid entries; anchored entries stay put.

    Uses the plan's stored generation config so the spirit of the accepted
    choice (preset, focus branch) survives task changes.  Returns the updated
    plan, or ``None`` when no plan is accepted.
    """
    plan = Plan.objects.filter(is_accepted=True).first()
    if plan is None:
        return None
    if now is None:
        now = timezone.now()

    snapshots = build_planning_tasks(
        Task.objects.filter(completed_at=None).prefetch_related("tags")
    )
    horizon = timedelta(days=settings.PLANNING_HORIZON_DAYS)
    buckets = gather_time_buckets(now, now + horizon)
    from tasks.models import TaskDependency
    edges = list(TaskDependency.objects.values_list("predecessor_id", "successor_id"))

    preset = plan.config.get("preset", "deadline_safe")
    focus = frozenset(UUID(t) for t in plan.config.get("focus_task_ids", []))
    ranked = _apply_focus(_preset_ranking(snapshots, preset, now), focus)
    allocation = allocate_tasks(buckets, ranked, edges, config=_preset_config(preset))

    anchored_ids = _anchored_task_ids()
    plan.entries.exclude(task_id__in=anchored_ids).delete()
    kept_entries = list(plan.entries.all())

    bucket_by_id = {bucket.id: bucket for bucket in buckets}
    new_pairs = [
        (bucket_id, item)
        for bucket_id, item in _chronological_items(allocation)
        if item.task.id not in anchored_ids
    ]

    # Orders: anchored entries keep theirs (byte-identical); new entries get
    # their rank in the merged chronological sequence.  `order` is meta-data —
    # display always sorts by start time.
    merged = sorted(
        [(entry.start, None, entry) for entry in kept_entries]
        + [(item.start_time, bucket_id, item) for bucket_id, item in new_pairs],
        key=lambda triple: triple[0],
    )
    new_entries: List[PlanEntry] = []
    for position, (_, bucket_id, payload) in enumerate(merged):
        if isinstance(payload, PlanEntry):
            continue
        entry = PlanEntry(
            plan=plan, task=payload.task, start=payload.start_time,
            duration=payload.duration, order=position,
        )
        if bucket_id is not UNBUCKETED:
            bucket = bucket_by_id[bucket_id]
            if not _is_persisted(bucket):
                bucket.save()  # plan is accepted: materialization is allowed (A8)
            entry.bucket = bucket
        new_entries.append(entry)
    PlanEntry.objects.bulk_create(new_entries)

    metrics, warnings = _evaluate(allocation, snapshots, now)
    plan.metrics = _metrics_json(metrics)
    plan.warnings = _warnings_json(warnings)
    plan.feasible = not warnings
    plan.save(update_fields=["metrics", "warnings", "feasible"])
    return plan


def find_placement_conflict(task: Task, start: datetime):
    """Manual placement guard (§6 fixing rules): placing ``task`` at ``start``
    is invalid if an *unfinished* predecessor's accepted-plan allocation ends
    after ``start``.  Returns ``(predecessor, available_from)`` or ``None``.

    Permissive when there is no accepted plan or the predecessor has no
    entries in it — without plan information no ordering can be guaranteed,
    and blocking would make manual planning impossible before the first
    acceptance.
    """
    plan = Plan.objects.filter(is_accepted=True).first()
    if plan is None:
        return None
    predecessors = Task.objects.filter(
        outgoing_dependencies__successor=task, completed_at=None
    )
    worst = None
    for predecessor in predecessors:
        entries = list(plan.entries.filter(task=predecessor))
        if not entries:
            continue
        end = max(entry.start + entry.duration for entry in entries)
        if start < end and (worst is None or end > worst[1]):
            worst = (predecessor, end)
    return worst
