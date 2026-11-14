"""Sorting tracked time afterwards (docs/sort-time.md, README: Time
tracking): a work block is a stretch of work whose split between tasks is
decided later — begun with "Start work" before a task was chosen, a session
that covered several tasks, or a gap in the time sheet. The tasks ticked for
it share its time by their estimates (:func:`shares`); the shares become
ordinary tracking sessions, marked ``apportioned``, laid end to end in the
block.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional

from django.db import transaction
from django.utils import timezone

from tasks.models import Task, TrackingSession, WorkBlock, WorkBlockItem, minutely_str

MINUTE = timedelta(minutes=1)


class SharesError(Exception):
    """Why the block's time cannot be shared out so."""


@dataclass(frozen=True)
class Share:
    """A ticked task as far as its share goes."""
    #: Its estimate (the default duration without one).
    estimate: timedelta
    #: Tracked on it outside this block.
    spent_elsewhere: timedelta
    #: Done (☑) — else worked on (◐), which weighs half.
    completed: bool = True
    #: Typed by the user: this long, not scaled.
    pinned: Optional[timedelta] = None

    @property
    def weight(self) -> timedelta:
        """What is left of its estimate, at least a quarter of it; half for
        a task only worked on."""
        left = max(self.estimate - self.spent_elsewhere, self.estimate / 4, timedelta(0))
        return left if self.completed else left / 2


def shares(total: timedelta, items: List[Share]) -> List[timedelta]:
    """Each item's share of ``total``, in order: pinned ones as typed, the
    others by weight, scaled to fill what is left — in whole minutes, the
    last one taking the seconds, so they add up to ``total`` exactly. With
    every item pinned, what is left stays untracked."""
    pinned = sum((item.pinned for item in items if item.pinned is not None), timedelta(0))
    if pinned > total:
        raise SharesError(f"The minutes typed add up to {minutely_str(pinned)}, "
                          f"more than the {minutely_str(total)} to share.")
    free = [index for index, item in enumerate(items) if item.pinned is None]
    result = [item.pinned if item.pinned is not None else timedelta(0) for item in items]
    if not free:
        return result
    left = total - pinned
    weights = [items[index].weight.total_seconds() for index in free]
    whole = sum(weights)
    if whole <= 0:
        weights, whole = [1.0] * len(free), float(len(free))
    # Rounded where the shares meet, so the rounding does not add up.
    reached, previous = 0.0, timedelta(0)
    for position, index in enumerate(free):
        reached += weights[position]
        if position == len(free) - 1:
            boundary = left
        else:
            boundary = MINUTE * round(left.total_seconds() * reached / whole / 60)
        result[index] = boundary - previous
        previous = boundary
    return result


class SortError(Exception):
    """Why a block cannot be sorted so."""


@dataclass
class Tick:
    """A task ticked in the sheet: an existing one, or ``new`` (header,
    duration, parent_id, tag_ids) made right there, already done."""
    task: Optional[Task] = None
    new: Optional[dict] = None
    #: Done (☑) — else worked on (◐).
    completed: bool = True
    pinned: Optional[timedelta] = None


def _moment(value: datetime) -> str:
    return f"{timezone.localtime(value):%a %d/%m %H:%M}"


def _check_span(start: datetime, end: datetime, now: datetime, ignore=()) -> None:
    """A stretch of real work: over, and not tracked already (``ignore``:
    sessions that give way to it)."""
    from tasks.services.sessions import CLOCK_SLACK
    if end <= start:
        raise SortError("The end is not after the start.")
    if end > now + CLOCK_SLACK:
        raise SortError("This is in the future. Sort it once it is over.")
    others = (TrackingSession.objects.filter(start__lt=end).exclude(id__in=[s.id for s in ignore])
              .select_related("task").order_by("start"))
    for other in others:
        if (other.end or now) > start:
            other_end = "now" if other.end is None else _moment(other.end)
            raise SortError(f"This overlaps “{other.task.header}” ({_moment(other.start)} – {other_end}), "
                            "which is tracked already.")


def _unsort(block: WorkBlock, keep_task_ids=frozenset()) -> None:
    """Take back what sorting ``block`` did: its sessions, the completions
    it made, the tasks made in its sheet (but those in ``keep_task_ids``)."""
    from tasks.services.completion import reopen
    from tasks.services.sessions import _book, booked
    for session in list(block.sessions.select_related("task")):
        task, length = session.task, booked(session)
        session.delete()
        _book(task, -length)
    for item in block.items.select_related("task"):
        task = Task.objects.get(id=item.task_id)
        if item.created_here and task.id not in keep_task_ids:
            task.delete()
        elif item.completed_here and task.is_done:
            reopen(task)
        else:
            _note_apportioned(task)
    block.items.all().delete()


def _note_apportioned(task: Task) -> None:
    """A done task's figures say how much of its time was shared out."""
    if not task.is_done:
        return
    apportioned = sum((s.end - s.start for s in TrackingSession.objects.filter(task=task, apportioned=True)
                       if s.end is not None), timedelta(0))
    task.completion_time_apportioned = apportioned or None
    task.save(update_fields=["completion_time_apportioned"])


def _make(new: dict) -> Task:
    """A task added in the sheet: its estimate was typed after the work."""
    from tasks.services.estimates import record_estimate_change
    from tasks.services.tree import next_sibling_order
    parent_id = new.get("parent_id")
    task = Task.objects.create(header=new["header"], duration=new.get("duration"), parent_id=parent_id,
                               order=next_sibling_order(parent_id))
    if new.get("tag_ids"):
        task.tags.set(new["tag_ids"])
    record_estimate_change(task, None, task.duration, "logged")
    return task


@transaction.atomic
def sort_block(block: WorkBlock, ticks: List[Tick], now: Optional[datetime] = None) -> WorkBlock:
    """Share the block's time out among ``ticks``, in their order: one
    apportioned session each, end to end from the block's start; a ticked
    task is completed at the end of its share. Sorting again replaces what
    sorting did before."""
    from tasks.services.completion import CompletionError, complete_finished_ancestors, ensure_completable
    from tasks.services.estimates import write_completion_snapshot
    from tasks.services.sessions import _book
    from tasks.services.settings import default_duration
    now = now or timezone.now()
    if block.end is None:
        raise SortError("This work is still running: stop it first.")
    if not ticks:
        raise SortError("Tick at least one task you worked on.")
    made_before = set(block.items.filter(created_here=True).values_list("task_id", flat=True))
    _unsort(block, keep_task_ids={tick.task.id for tick in ticks if tick.task is not None})
    tasks = [tick.task if tick.task is not None else _make(tick.new) for tick in ticks]
    tasks = [Task.objects.get(id=task.id) for task in tasks]  # their tracked time as it is now
    for task, tick in zip(tasks, ticks):
        if tick.completed and not task.is_done:
            try:
                ensure_completable(task)
            except CompletionError as error:
                raise SortError(str(error)) from error
    fallback = default_duration()
    items = [Share(estimate=task.duration if task.duration is not None else fallback,
                   spent_elsewhere=task.time_spent, completed=tick.completed, pinned=tick.pinned)
             for task, tick in zip(tasks, ticks)]
    lengths = shares(block.end - block.start, items)

    cursor = block.start
    created_ids = {task.id for task, tick in zip(tasks, ticks) if tick.task is None} | made_before
    for order, (task, tick, share, length) in enumerate(zip(tasks, ticks, items, lengths)):
        end = cursor + length
        if length > timedelta(0):
            TrackingSession.objects.create(task=task, start=cursor, end=end, block=block, apportioned=True)
            _book(task, length)
            task.refresh_from_db()
        completed_here = False
        if tick.completed and not task.is_done:
            task.completed_at = end
            task.save(update_fields=["completed_at"])
            write_completion_snapshot(task)
            complete_finished_ancestors(task, end)
            completed_here = True
        _note_apportioned(task)
        WorkBlockItem.objects.create(block=block, task=task, order=order, weight=share.weight, pinned=tick.pinned,
                                     completed=tick.completed, completed_here=completed_here,
                                     created_here=task.id in created_ids)
        cursor = end
    block.sorted_at = now
    block.save(update_fields=["sorted_at"])
    return block


@transaction.atomic
def fill_gap(start: datetime, end: datetime, ticks: List[Tick], now: Optional[datetime] = None) -> WorkBlock:
    """Time that was not tracked at all, sorted at once."""
    now = now or timezone.now()
    _check_span(start, end, now)
    block = WorkBlock.objects.create(start=start, end=end, origin="gap")
    return sort_block(block, ticks, now=now)


@transaction.atomic
def split_session(session: TrackingSession, ticks: List[Tick], now: Optional[datetime] = None) -> WorkBlock:
    """A session that covered several tasks, shared out among them."""
    from tasks.services.sessions import remove_session
    now = now or timezone.now()
    if session.end is None:
        raise SortError("This session is still running: stop it first.")
    if session.block_id is not None:
        raise SortError("This is a share of sorted time already: sort that again instead.")
    block = WorkBlock.objects.create(start=session.start, end=session.end, origin="split",
                                     original_task=session.task)
    remove_session(session)
    return sort_block(block, ticks, now=now)


@transaction.atomic
def undo_block(block: WorkBlock) -> None:
    """Back to how it was before sorting: a split session comes back, a
    gap goes, time begun with "Start work" is to sort again."""
    from tasks.services.sessions import _book
    _unsort(block)
    if block.origin == "started":
        block.sorted_at = None
        block.save(update_fields=["sorted_at"])
        return
    if block.origin == "split" and block.original_task is not None:
        session = TrackingSession.objects.create(task=block.original_task, start=block.start, end=block.end)
        _book(block.original_task, session.end - session.start)
    block.delete()


def open_block() -> Optional[WorkBlock]:
    """The work begun with "Start work" that is running now."""
    return WorkBlock.objects.filter(origin="started", end=None).first()


def end_open_block(now: datetime) -> Optional[WorkBlock]:
    """End the running "Start work" block (to sort); less than a minute of
    it is nothing to sort and goes."""
    block = open_block()
    if block is None:
        return None
    if now - block.start < MINUTE:
        block.delete()
        return None
    block.end = now
    block.save(update_fields=["end"])
    return block


@transaction.atomic
def start_work(now: Optional[datetime] = None) -> WorkBlock:
    """Work begins, the first task not chosen yet. A task being tracked is
    stopped first; work already begun goes on."""
    from tasks.services.tracking import _close, _open_session
    now = now or timezone.now()
    running = open_block()
    if running is not None:
        return running
    session = _open_session()
    if session is not None:
        _close(session, now)
    return WorkBlock.objects.create(start=now, origin="started")


@transaction.atomic
def stop_work(now: Optional[datetime] = None) -> Optional[WorkBlock]:
    """Stop the work begun with "Start work": it is to sort now."""
    now = now or timezone.now()
    if open_block() is None:
        raise SortError("Work begun with “Start work” is not running.")
    return end_open_block(now)
