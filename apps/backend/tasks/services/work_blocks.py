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
from datetime import timedelta
from typing import List, Optional

from tasks.models import minutely_str

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
