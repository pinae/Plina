"""Sorting tracked time afterwards (docs/sort-time.md, README: Time
tracking): a stretch of work whose split between tasks is decided later is
a work block; the tasks ticked for it share its time by their estimates."""
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model

from plina.scoping import owner_scope
from tasks.models import (
    Task,
    TaskEstimateChange,
    TrackingSession,
    WorkBlock,
    WorkBlockItem,
)
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


class SortingTest(TestCase):
    """S3: sorting a block makes its shares; sorting again replaces them,
    Undo restores what was there before."""

    def setUp(self):
        self.now = at(13)
        self.project = Task.objects.create(header="Website")
        self.a = Task.objects.create(header="Header", duration=minutes(60), parent=self.project, order=0)
        self.b = Task.objects.create(header="Footer", duration=minutes(30), parent=self.project, order=1)
        self.later = Task.objects.create(header="Later", duration=minutes(30), parent=self.project, order=2)

    def tick(self, task=None, **kwargs):
        from tasks.services.work_blocks import Tick
        return Tick(task=task, **kwargs)

    def gap(self, *ticks, start=None, end=None):
        from tasks.services.work_blocks import fill_gap
        return fill_gap(start or at(9), end or at(12), list(ticks), now=self.now)

    def sessions(self):
        return [(s.task.header, s.start, s.end, s.apportioned) for s in TrackingSession.objects.order_by("start")]

    def fresh(self, task):
        return Task.objects.get(id=task.id)

    def test_the_ticked_tasks_share_the_block_end_to_end(self):
        block = self.gap(self.tick(self.a), self.tick(self.b))

        self.assertEqual(self.sessions(), [("Header", at(9), at(11), True), ("Footer", at(11), at(12), True)])
        a, b = self.fresh(self.a), self.fresh(self.b)
        self.assertEqual((a.time_spent, b.time_spent), (minutes(120), minutes(60)))
        # Done at the end of its share, with figures that say how it was measured.
        self.assertEqual((a.completed_at, b.completed_at), (at(11), at(12)))
        self.assertEqual((a.completion_time_spent, a.completion_time_apportioned), (minutes(120), minutes(120)))
        self.assertEqual(block.sorted_at, self.now)
        self.assertEqual([(i.task_id, i.weight, i.completed, i.completed_here) for i in block.items.all()],
                         [(self.a.id, minutes(60), True, True), (self.b.id, minutes(30), True, True)])

    def test_worked_on_is_not_completed(self):
        self.gap(self.tick(self.a), self.tick(self.b, completed=False))
        b = self.fresh(self.b)
        self.assertFalse(b.is_done)
        self.assertEqual(b.time_spent, timedelta(hours=3) * 15 / 75)  # 60 : 15

    def test_a_task_added_in_the_sheet_is_made_done(self):
        from tasks.models import Tag
        urgent = Tag.objects.create(name="urgent")
        block = self.gap(self.tick(self.a), self.tick(new={"header": "Hotfix", "duration": minutes(60),
                                                         "parent_id": self.project.id, "tag_ids": [urgent.id]}))
        hotfix = Task.objects.get(header="Hotfix")
        self.assertEqual((hotfix.parent_id, list(hotfix.tags.all()), hotfix.completed_at),
                         (self.project.id, [urgent], at(12)))
        self.assertEqual(hotfix.time_spent, minutes(90))
        self.assertEqual(list(hotfix.estimate_changes.values_list("reason", flat=True)), ["logged"])
        self.assertTrue(block.items.get(task=hotfix).created_here)

    def test_pinned_minutes(self):
        self.gap(self.tick(self.a, pinned=minutes(150)), self.tick(self.b))
        self.assertEqual(self.sessions(), [("Header", at(9), at(11, 30), True), ("Footer", at(11, 30), at(12), True)])

    def test_sorting_again_replaces_the_shares(self):
        from tasks.services.work_blocks import sort_block
        block = self.gap(self.tick(self.a), self.tick(new={"header": "Hotfix", "duration": minutes(30)}))
        sort_block(block, [self.tick(self.b), self.tick(self.later)], now=self.now)

        self.assertEqual(self.sessions(), [("Footer", at(9), at(10, 30), True), ("Later", at(10, 30), at(12), True)])
        a = self.fresh(self.a)
        self.assertEqual((a.time_spent, a.completed_at, a.completion_time_spent), (timedelta(0), None, None))
        self.assertFalse(Task.objects.filter(header="Hotfix").exists())  # made in the sheet, no longer ticked
        self.assertEqual(block.items.count(), 2)

    def test_a_task_made_in_the_sheet_and_still_ticked_stays_made_there(self):
        from tasks.services.work_blocks import sort_block, undo_block
        block = self.gap(self.tick(new={"header": "Hotfix", "duration": minutes(30)}))
        hotfix = Task.objects.get(header="Hotfix")
        sort_block(block, [self.tick(hotfix), self.tick(self.a)], now=self.now)
        self.assertTrue(block.items.get(task=hotfix).created_here)
        undo_block(block)
        self.assertFalse(Task.objects.filter(header="Hotfix").exists())

    def test_a_task_done_before_keeps_its_completion(self):
        self.b.completed_at = at(8)
        self.b.save()
        self.gap(self.tick(self.a), self.tick(self.b))
        b = self.fresh(self.b)
        self.assertEqual((b.completed_at, b.time_spent, b.completion_time_apportioned), (at(8), minutes(60), minutes(60)))

    def test_undo_of_a_gap_removes_it(self):
        from tasks.services.work_blocks import undo_block
        block = self.gap(self.tick(self.a), self.tick(new={"header": "Hotfix", "duration": minutes(30)}))
        undo_block(block)
        self.assertEqual(self.sessions(), [])
        a = self.fresh(self.a)
        self.assertEqual((a.time_spent, a.is_done), (timedelta(0), False))
        self.assertFalse(Task.objects.filter(header="Hotfix").exists())
        self.assertFalse(WorkBlock.objects.exists())

    def test_splitting_a_session_and_undo(self):
        from tasks.services.sessions import add_session
        from tasks.services.work_blocks import split_session, undo_block
        session = add_session(self.a, at(9), at(12), now=self.now)
        self.assertEqual(self.fresh(self.a).time_spent, minutes(180))

        block = split_session(session, [self.tick(self.a), self.tick(self.b)], now=self.now)
        self.assertEqual(self.sessions(), [("Header", at(9), at(11), True), ("Footer", at(11), at(12), True)])
        self.assertEqual(self.fresh(self.a).time_spent, minutes(120))
        self.assertEqual((block.origin, block.original_task_id), ("split", self.a.id))

        undo_block(block)
        self.assertEqual(self.sessions(), [("Header", at(9), at(12), False)])
        a, b = self.fresh(self.a), self.fresh(self.b)
        self.assertEqual((a.time_spent, a.is_done, b.time_spent, b.is_done), (minutes(180), False, timedelta(0), False))

    def test_undo_of_a_started_block_leaves_it_to_sort(self):
        from tasks.services.work_blocks import sort_block, undo_block
        block = WorkBlock.objects.create(start=at(9), end=at(12), origin="started")
        sort_block(block, [self.tick(self.a)], now=self.now)
        undo_block(block)
        block.refresh_from_db()
        self.assertIsNone(block.sorted_at)
        self.assertEqual((self.sessions(), block.items.count()), ([], 0))

    def test_refusals(self):
        from tasks.services.sessions import add_session
        from tasks.services.work_blocks import SortError, sort_block
        add_session(self.later, at(10), at(10, 30), now=self.now)
        with self.assertRaisesMessage(SortError, "overlaps “Later”"):
            self.gap(self.tick(self.a))
        with self.assertRaisesMessage(SortError, "future"):
            self.gap(self.tick(self.a), start=at(12), end=at(14))
        with self.assertRaisesMessage(SortError, "Tick"):
            self.gap(start=at(11), end=at(12))
        running = WorkBlock.objects.create(start=at(11), origin="started")
        with self.assertRaisesMessage(SortError, "still running"):
            sort_block(running, [self.tick(self.a)], now=self.now)
        running.delete()
        with self.assertRaisesMessage(SortError, "open subtask"):
            self.gap(self.tick(self.project), start=at(11), end=at(12))
        self.assertFalse(WorkBlock.objects.exists())
        self.assertEqual(len(self.sessions()), 1)

    def test_merging_a_ticked_task_keeps_its_share(self):
        from tasks.services.merge import merge_into
        block = self.gap(self.tick(self.a), self.tick(self.b))
        merge_into(self.later, self.fresh(self.b))
        self.assertEqual([item.task_id for item in block.items.all()], [self.a.id, self.later.id])
        self.assertEqual(self.fresh(self.later).time_spent, minutes(60))


class StartWorkTest(TestCase):
    """S4: "Start work" before the first task is chosen."""

    def setUp(self):
        self.task = Task.objects.create(header="Urgent", duration=minutes(60))

    def test_start_and_stop(self):
        from tasks.services.work_blocks import open_block, start_work, stop_work
        block = start_work(now=at(8, 47))
        self.assertEqual((block.origin, block.start, block.end), ("started", at(8, 47), None))
        self.assertEqual(start_work(now=at(9)), block)  # one at a time
        self.assertEqual(open_block(), block)

        stopped = stop_work(now=at(11, 30))
        self.assertEqual((stopped.end, stopped.sorted_at), (at(11, 30), None))  # to sort
        self.assertIsNone(open_block())
        self.assertEqual(Task.objects.get(id=self.task.id).time_spent, timedelta(0))

    def test_starting_a_task_ends_the_block_to_sort(self):
        from tasks.services.tracking import start_tracking
        from tasks.services.work_blocks import start_work
        block = start_work(now=at(8, 47))
        start_tracking(self.task, now=at(10))
        block.refresh_from_db()
        self.assertEqual((block.end, block.sorted_at), (at(10), None))

    def test_start_work_stops_the_running_task(self):
        from tasks.services.tracking import start_tracking
        from tasks.services.work_blocks import start_work
        start_tracking(self.task, now=at(9))
        start_work(now=at(9, 30))
        self.assertEqual(Task.objects.get(id=self.task.id).time_spent, minutes(30))
        self.assertFalse(TrackingSession.objects.filter(end=None).exists())

    def test_less_than_a_minute_is_nothing_to_sort(self):
        from tasks.services.work_blocks import start_work, stop_work
        start_work(now=at(9))
        self.assertIsNone(stop_work(now=at(9, 0) + timedelta(seconds=40)))
        self.assertFalse(WorkBlock.objects.exists())

    def test_stop_without_a_block(self):
        from tasks.services.work_blocks import SortError, stop_work
        with self.assertRaisesMessage(SortError, "not running"):
            stop_work(now=at(9))


class SuggestionsTest(TestCase):
    """S6: what the sheet offers to tick, so it is recognised, not recalled."""

    def setUp(self):
        self.project = Task.objects.create(header="Website")
        self.tracked = Task.objects.create(header="Header", duration=minutes(60), parent=self.project, order=0)
        self.sibling = Task.objects.create(header="Footer", duration=minutes(30), parent=self.project, order=1)
        self.done_sibling = Task.objects.create(header="Logo", parent=self.project, order=2, completed_at=at(7))
        self.planned = Task.objects.create(header="Invoice", duration=minutes(30))
        self.finished = Task.objects.create(header="Call back", completed_at=at(10, 30))  # done meanwhile, no time
        self.recent = Task.objects.create(header="Review", duration=minutes(30))
        TrackingSession.objects.create(task=self.recent, start=at(8, 0, day=14), end=at(9, 0, day=14))
        self.old = Task.objects.create(header="Ancient")
        TrackingSession.objects.create(task=self.old, start=at(8, 0, day=1), end=at(9, 0, day=1))
        from tasks.models import Plan, PlanEntry
        plan = Plan.objects.create(label="Accepted", is_accepted=True)
        PlanEntry.objects.create(plan=plan, task=self.planned, start=at(11), duration=minutes(30), order=0)
        PlanEntry.objects.create(plan=plan, task=self.sibling, start=at(9), duration=minutes(30), order=1)

    def suggested(self, **kwargs):
        from tasks.services.work_blocks import suggestions
        return [(task.header, reason) for task, reason in suggestions(at(9), at(12), **kwargs)]

    def test_the_sources_in_their_order(self):
        self.assertEqual(self.suggested(task=self.tracked)[:5], [
            ("Header", "tracked"), ("Call back", "done meanwhile"), ("Footer", "planned"), ("Invoice", "planned"),
            ("Review", "recent"),
        ])  # then the rest by priority (SuggestionsOnAFreshDayTest)

    def test_without_a_tracked_task(self):
        self.assertEqual([header for header, _ in self.suggested()][:4], ["Call back", "Footer", "Invoice", "Review"])

    def test_same_project_and_no_parents(self):
        extra = Task.objects.create(header="Menu", parent=self.project, order=3)
        suggested = self.suggested(task=self.tracked)
        self.assertIn(("Menu", "same project"), suggested)
        self.assertNotIn("Website", [header for header, _ in suggested])  # a parent is not ticked itself
        self.assertNotIn("Logo", [header for header, _ in suggested])  # done before the block
        self.assertEqual(len(suggested), len({header for header, _ in suggested}))
        self.assertTrue(extra)

    def test_the_api(self):
        from tasks.tests.support import APIClient
        response = APIClient().get(f"/api/work-blocks/suggestions/?start={at(9).isoformat().replace('+', '%2B')}"
                                   f"&end={at(12).isoformat().replace('+', '%2B')}&task={self.tracked.id}")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data[0], {"task_id": str(self.tracked.id), "reason": "tracked"})


class TimeSheetTest(TestCase):
    """S6: time to sort counts as work; shared-out time says so."""

    def setUp(self):
        from tasks.models import Tag
        self.work = Tag.objects.create(name="Arbeit")
        self.task = Task.objects.create(header="Report", duration=minutes(60))
        self.task.tags.add(self.work)

    def sheet(self, now=None):
        from tasks.services.timesheet import time_sheet
        [day] = time_sheet(at(0).date(), at(0).date(), now=now or at(18), zone=UTC)
        return day

    def test_time_to_sort_counts_as_work(self):
        WorkBlock.objects.create(start=at(8), end=at(10), origin="started")
        TrackingSession.objects.create(task=self.task, start=at(10), end=at(11))
        day = self.sheet()
        self.assertEqual((day.begin, day.end, day.working_seconds), (at(8), at(11), 3 * 3600))
        unsorted = day.entries[0]
        self.assertEqual((unsorted.header, unsorted.task_id, unsorted.kind, unsorted.seconds),
                         ("Not sorted yet", None, "work", 7200))
        self.assertTrue(unsorted.block_id)

    def test_running_start_work_counts_until_now(self):
        WorkBlock.objects.create(start=at(8), origin="started")
        day = self.sheet(now=at(9, 30))
        self.assertTrue(day.running)
        self.assertEqual(day.entries[0].seconds, 5400)

    def test_shared_out_time_is_approximate(self):
        from tasks.services.work_blocks import Tick, fill_gap
        fill_gap(at(8), at(9), [Tick(task=self.task, completed=False)], now=at(18))
        TrackingSession.objects.create(task=self.task, start=at(10), end=at(11))
        [entry] = self.sheet().entries
        self.assertEqual((entry.seconds, entry.approximate), (7200, True))


class SuggestionsOnAFreshDayTest(TestCase):
    """S6, found in the live check: "Start work" on a day with nothing
    tracked or planned yet still offers tasks — the active project's, then
    the most urgent ones by priority."""

    def test_the_active_project_then_by_priority(self):
        from tasks.services.settings import activate
        from tasks.services.work_blocks import suggestions
        blog = Task.objects.create(header="Blog")
        draft = Task.objects.create(header="Draft", parent=blog, order=0, priority=3)
        shop = Task.objects.create(header="Shop")
        Task.objects.create(header="Checkout", parent=shop, order=0, priority=9)
        Task.objects.create(header="Low", priority=1)
        Task.objects.create(header="Gone", priority=10, completed_at=at(7))
        activate(blog)
        self.assertEqual([(task.header, reason) for task, reason in suggestions(at(9), at(12))],
                         [("Draft", "active project"), ("Checkout", "priority"), ("Low", "priority")])
        self.assertTrue(draft)
