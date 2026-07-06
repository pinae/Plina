"""Unit tests for WP-2: DAG analysis (topology, slack, critical chain).

All functions under test are pure: they accept any node objects exposing
``id``, ``remaining_duration``, ``latest_finish_date``, ``tag_ids`` and
``project_id`` (structural typing), plus plain edge tuples and
:class:`CapacityWindow` instances.  No database — SimpleTestCase throughout.
"""
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from django.test import SimpleTestCase

from tasks.services.graph import (
    CapacityTimeline,
    CapacityWindow,
    CycleError,
    analyze,
    branches,
    build_dag,
    critical_chain,
    feasibility_warnings,
    frontier,
    topological_order,
)


@dataclass(frozen=True)
class Node:
    """Minimal stand-in for a PlanningTask."""
    id: str
    remaining_duration: timedelta = timedelta(hours=1)
    latest_finish_date: datetime | None = None
    tag_ids: frozenset = frozenset()
    project_id: str | None = None


def hours(h: float) -> timedelta:
    return timedelta(hours=h)


NOW = datetime(2026, 7, 6, 8, 0)


def daily_windows(count: int, start_hour: int = 9, duration_hours: int = 4,
                  tag_ids: frozenset = frozenset()) -> list:
    """One window per day at ``start_hour`` for ``count`` days from NOW's date."""
    base = NOW.replace(hour=start_hour, minute=0)
    return [
        CapacityWindow(start=base + timedelta(days=i),
                       end=base + timedelta(days=i, hours=duration_hours),
                       tag_ids=tag_ids)
        for i in range(count)
    ]


class BuildDagTest(SimpleTestCase):
    def test_empty_graph(self):
        graph = build_dag([], [])
        self.assertEqual(topological_order(graph), [])
        self.assertEqual(frontier(graph), [])
        self.assertEqual(branches(graph), [])

    def test_cycle_raises_with_path(self):
        nodes = [Node("a"), Node("b")]
        with self.assertRaises(CycleError) as ctx:
            build_dag(nodes, [("a", "b"), ("b", "a")])
        self.assertIn("a", ctx.exception.cycle)
        self.assertIn("b", ctx.exception.cycle)

    def test_edges_to_unknown_nodes_are_dropped(self):
        """Edges from completed (filtered-out) tasks are already satisfied."""
        graph = build_dag([Node("b")], [("completed-task", "b")])
        self.assertEqual(frontier(graph), ["b"])


class TopologyTest(SimpleTestCase):
    def test_single_chain_keeps_its_order(self):
        nodes = [Node("a"), Node("b"), Node("c")]
        graph = build_dag(nodes, [("a", "b"), ("b", "c")])
        self.assertEqual(topological_order(graph), ["a", "b", "c"])

    def test_diamond_order_is_valid(self):
        nodes = [Node("a"), Node("b"), Node("c"), Node("d")]
        graph = build_dag(nodes, [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")])
        order = topological_order(graph)
        self.assertEqual(order[0], "a")
        self.assertEqual(order[-1], "d")
        self.assertEqual(set(order), {"a", "b", "c", "d"})

    def test_frontier_of_two_disjoint_chains(self):
        nodes = [Node("a1"), Node("a2"), Node("b1"), Node("b2")]
        graph = build_dag(nodes, [("a1", "a2"), ("b1", "b2")])
        self.assertEqual(frontier(graph), ["a1", "b1"])


class BranchesTest(SimpleTestCase):
    def test_disjoint_chains_form_project_grouped_branches(self):
        nodes = [
            Node("a1", project_id="P1"), Node("a2", project_id="P1"),
            Node("b1", project_id="P2"), Node("b2", project_id="P2"),
        ]
        graph = build_dag(nodes, [("a1", "a2"), ("b1", "b2")])

        result = branches(graph)

        self.assertEqual(len(result), 2)
        by_root = {branch.frontier_task_id: branch for branch in result}
        self.assertEqual(by_root["a1"].project_id, "P1")
        self.assertEqual(by_root["a1"].task_ids, {"a1", "a2"})
        self.assertEqual(by_root["b1"].project_id, "P2")
        self.assertEqual(by_root["b1"].task_ids, {"b1", "b2"})

    def test_diamond_is_one_branch(self):
        nodes = [Node(n) for n in "abcd"]
        graph = build_dag(nodes, [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")])
        result = branches(graph)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].task_ids, {"a", "b", "c", "d"})


class CapacityTimelineTest(SimpleTestCase):
    def setUp(self):
        self.timeline = CapacityTimeline(daily_windows(count=5))

    def test_finish_within_first_window(self):
        finish = self.timeline.finish_after(NOW, hours(2), frozenset())
        self.assertEqual(finish, NOW.replace(hour=11))

    def test_finish_spills_into_next_day(self):
        # 6h of work into 4h windows: 4h today, 2h tomorrow -> 11:00 next day.
        finish = self.timeline.finish_after(NOW, hours(6), frozenset())
        self.assertEqual(finish, NOW.replace(hour=11) + timedelta(days=1))

    def test_ready_time_inside_a_window_is_respected(self):
        ready = NOW.replace(hour=12)  # only 1h left today
        finish = self.timeline.finish_after(ready, hours(2), frozenset())
        self.assertEqual(finish, NOW.replace(hour=10) + timedelta(days=1))

    def test_insufficient_capacity_returns_none(self):
        self.assertIsNone(self.timeline.finish_after(NOW, hours(21), frozenset()))

    def test_affinity_excludes_untagged_task_from_tagged_window(self):
        tagged = CapacityTimeline(daily_windows(count=2, tag_ids=frozenset({"deep"})))
        self.assertIsNone(tagged.finish_after(NOW, hours(1), frozenset()))
        self.assertIsNotNone(tagged.finish_after(NOW, hours(1), frozenset({"deep"})))

    def test_start_before_deadline(self):
        deadline = NOW.replace(hour=9, minute=30) + timedelta(days=1)
        # 3h ending by day-1 09:30: 30m on day 1, 2h30 on day 0 -> start 10:30 day 0.
        start = self.timeline.start_before(deadline, hours(3), frozenset())
        self.assertEqual(start, NOW.replace(hour=10, minute=30))


class ForwardBackwardPassTest(SimpleTestCase):
    """Chain A(2h) -> B(3h) against 4h windows at 09:00 daily."""

    def setUp(self):
        self.deadline = NOW.replace(hour=9, minute=30) + timedelta(days=1)
        nodes = [
            Node("a", remaining_duration=hours(2)),
            Node("b", remaining_duration=hours(3), latest_finish_date=self.deadline),
        ]
        self.graph = build_dag(nodes, [("a", "b")])
        self.timeline = CapacityTimeline(daily_windows(count=5))
        self.estimates = analyze(self.graph, self.timeline, NOW)

    def test_earliest_times_respect_dependencies_and_capacity(self):
        self.assertEqual(self.estimates["a"].earliest_finish, NOW.replace(hour=11))
        # B: 2h left today (11:00-13:00), 1h tomorrow -> finish 10:00 day 1.
        self.assertEqual(
            self.estimates["b"].earliest_finish,
            NOW.replace(hour=10) + timedelta(days=1),
        )

    def test_latest_times_propagate_backward_through_capacity(self):
        self.assertEqual(self.estimates["b"].latest_finish, self.deadline)
        self.assertEqual(self.estimates["b"].latest_start, NOW.replace(hour=10, minute=30))
        # A must finish by B's latest start.
        self.assertEqual(self.estimates["a"].latest_finish, NOW.replace(hour=10, minute=30))

    def test_negative_slack_is_detected(self):
        # Projected finish 10:00 day 1 vs deadline 09:30 day 1.
        self.assertEqual(self.estimates["b"].slack, timedelta(minutes=-30))
        self.assertEqual(self.estimates["a"].slack, timedelta(minutes=-30))

    def test_no_deadline_means_unbounded_slack(self):
        graph = build_dag([Node("x", remaining_duration=hours(1))], [])
        estimates = analyze(graph, self.timeline, NOW)
        self.assertIsNone(estimates["x"].slack)


class CriticalChainTest(SimpleTestCase):
    def setUp(self):
        self.timeline = CapacityTimeline(daily_windows(count=10))

    def test_chain_with_missed_deadline_is_the_critical_chain(self):
        deadline = NOW.replace(hour=9, minute=30) + timedelta(days=1)
        nodes = [
            Node("a", remaining_duration=hours(2)),
            Node("b", remaining_duration=hours(3), latest_finish_date=deadline),
        ]
        graph = build_dag(nodes, [("a", "b")])
        estimates = analyze(graph, self.timeline, NOW)
        self.assertEqual(critical_chain(graph, estimates), ["a", "b"])

    def test_diamond_critical_chain_follows_the_long_arm(self):
        deadline = NOW + timedelta(days=1, hours=1)
        nodes = [
            Node("a", remaining_duration=hours(1)),
            Node("b", remaining_duration=hours(3)),  # long arm
            Node("c", remaining_duration=hours(1)),  # short arm
            Node("d", remaining_duration=hours(1), latest_finish_date=deadline),
        ]
        graph = build_dag(nodes, [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")])
        estimates = analyze(graph, self.timeline, NOW)
        self.assertEqual(critical_chain(graph, estimates), ["a", "b", "d"])

    def test_no_deadlines_means_no_critical_chain(self):
        graph = build_dag([Node("a"), Node("b")], [("a", "b")])
        estimates = analyze(graph, self.timeline, NOW)
        self.assertEqual(critical_chain(graph, estimates), [])


class FeasibilityWarningsTest(SimpleTestCase):
    def setUp(self):
        self.timeline = CapacityTimeline(daily_windows(count=10))

    def test_missed_deadline_yields_warning_naming_the_chain(self):
        deadline = NOW.replace(hour=9, minute=30) + timedelta(days=1)
        nodes = [
            Node("a", remaining_duration=hours(2)),
            Node("b", remaining_duration=hours(3), latest_finish_date=deadline),
        ]
        graph = build_dag(nodes, [("a", "b")])

        warnings = feasibility_warnings(graph, self.timeline, NOW)

        self.assertEqual(len(warnings), 1)
        warning = warnings[0]
        self.assertEqual(warning.task_id, "b")
        self.assertEqual(warning.deadline, deadline)
        self.assertEqual(warning.projected_finish, NOW.replace(hour=10) + timedelta(days=1))
        self.assertEqual(warning.chain, ["a", "b"])

    def test_feasible_graph_yields_no_warnings(self):
        nodes = [
            Node("a", remaining_duration=hours(1)),
            Node("b", remaining_duration=hours(1),
                 latest_finish_date=NOW + timedelta(days=5)),
        ]
        graph = build_dag(nodes, [("a", "b")])
        self.assertEqual(feasibility_warnings(graph, self.timeline, NOW), [])

    def test_task_without_matching_capacity_is_reported(self):
        tagged_timeline = CapacityTimeline(
            daily_windows(count=10, tag_ids=frozenset({"deep"}))
        )
        graph = build_dag([Node("a", tag_ids=frozenset({"other"}))], [])

        warnings = feasibility_warnings(graph, tagged_timeline, NOW)

        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0].task_id, "a")
        self.assertIsNone(warnings[0].projected_finish)


class PerformanceTest(SimpleTestCase):
    def test_500_task_chain_analyzes_in_under_a_second(self):
        count = 500
        nodes = [
            Node(f"t{i}", remaining_duration=timedelta(minutes=30),
                 latest_finish_date=NOW + timedelta(days=90) if i == count - 1 else None)
            for i in range(count)
        ]
        edges = [(f"t{i}", f"t{i + 1}") for i in range(count - 1)]
        timeline = CapacityTimeline(daily_windows(count=90))

        started = time.monotonic()
        graph = build_dag(nodes, edges)
        estimates = analyze(graph, timeline, NOW)
        feasibility_warnings(graph, timeline, NOW)
        critical_chain(graph, estimates)
        elapsed = time.monotonic() - started

        self.assertLess(elapsed, 1.0)
