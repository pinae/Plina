"""Sorting tracked time afterwards (docs/sort-time.md, README: Time
tracking): a stretch of work whose split between tasks is decided later is
a work block; the tasks ticked for it share its time by their estimates."""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model

from plina.scoping import owner_scope
from tasks.models import Task, TaskEstimateChange, TrackingSession, WorkBlock, WorkBlockItem
from tasks.tests.support import TestCase

UTC = dt_timezone.utc


def at(hour, minute=0, day=16):
    """Monday 16 November 2026, UTC."""
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def minutes(value):
    return timedelta(minutes=value)


class ModelTest(TestCase):
    """S1: the rows a work block keeps."""

    def test_a_block_with_its_items_and_sessions(self):
        task = Task.objects.create(header="Write", duration=minutes(60))
        block = WorkBlock.objects.create(start=at(9), end=at(11), origin="gap")
        WorkBlockItem.objects.create(block=block, task=task, order=0, weight=minutes(60), completed=True)
        TrackingSession.objects.create(task=task, start=at(9), end=at(11), block=block, apportioned=True)

        self.assertEqual(block.items.get().task, task)
        self.assertTrue(block.sessions.get().apportioned)
        self.assertIsNone(block.sorted_at)
        block.delete()
        self.assertFalse(TrackingSession.objects.exists())  # its shares go with it
        self.assertTrue(Task.objects.filter(id=task.id).exists())

    def test_blocks_are_their_owners(self):
        WorkBlock.objects.create(start=at(9), end=None, origin="started")
        other = get_user_model().objects.create_user("other")
        with owner_scope(other):
            self.assertFalse(WorkBlock.objects.exists())

    def test_completion_figures_and_estimate_reasons_for_logged_work(self):
        task = Task.objects.create(header="Hotfix", duration=minutes(45), completion_time_apportioned=minutes(40))
        self.assertEqual(task.completion_time_apportioned, minutes(40))
        self.assertIn("logged", dict(TaskEstimateChange.REASONS))


class SharesTest(TestCase):
    """S2: how a block's time is shared out (services.work_blocks.shares)."""

    def shares(self, total, *items):
        from tasks.services.work_blocks import Share, shares
        return shares(total, [Share(**item) for item in items])

    def done(self, estimate, spent=0, pinned=None, completed=True):
        return {"estimate": minutes(estimate), "spent_elsewhere": minutes(spent), "completed": completed,
                "pinned": None if pinned is None else minutes(pinned)}

    def test_by_estimate_scaled_to_fill_the_block(self):
        # 1h and 30m of estimates in 3 hours: 2h and 1h.
        self.assertEqual(self.shares(minutes(180), self.done(60), self.done(30)), [minutes(120), minutes(60)])

    def test_time_tracked_elsewhere_counts_what_is_left(self):
        # Half of the 2h already tracked: it weighs 1h, like the other one.
        self.assertEqual(self.shares(minutes(120), self.done(120, spent=60), self.done(60)),
                         [minutes(60), minutes(60)])

    def test_at_least_a_quarter_of_the_estimate(self):
        # Already over its estimate: still a quarter of it (15m) against 45m.
        self.assertEqual(self.shares(minutes(120), self.done(60, spent=90), self.done(45)),
                         [minutes(30), minutes(90)])

    def test_worked_on_counts_half(self):
        self.assertEqual(self.shares(minutes(90), self.done(60), self.done(60, completed=False)),
                         [minutes(60), minutes(30)])

    def test_pinned_minutes_stay_and_the_rest_scales(self):
        self.assertEqual(self.shares(minutes(150), self.done(60, pinned=30), self.done(60), self.done(30)),
                         [minutes(30), minutes(80), minutes(40)])

    def test_all_pinned_leaves_the_rest_untracked(self):
        self.assertEqual(self.shares(minutes(120), self.done(60, pinned=30), self.done(60, pinned=45)),
                         [minutes(30), minutes(45)])

    def test_pinned_beyond_the_block_is_refused(self):
        from tasks.services.work_blocks import SharesError
        with self.assertRaisesMessage(SharesError, "2h 15m"):
            self.shares(minutes(120), self.done(60, pinned=90), self.done(60, pinned=45))

    def test_whole_minutes_that_add_up_exactly(self):
        total = timedelta(hours=2, minutes=13, seconds=37)
        result = self.shares(total, self.done(10), self.done(10), self.done(10))
        self.assertEqual(sum(result, timedelta(0)), total)
        self.assertTrue(all(share.seconds % 60 == 0 for share in result[:-1]), result)
        self.assertLessEqual(max(result) - min(result), minutes(1))

    def test_without_weight_the_time_is_shared_evenly(self):
        self.assertEqual(self.shares(minutes(60), self.done(0), self.done(0)), [minutes(30), minutes(30)])
