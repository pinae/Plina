"""Unit tests for the pure graph helpers.

These functions operate on plain (predecessor_id, successor_id) tuples and
must not touch the database — hence SimpleTestCase.
"""
from django.test import SimpleTestCase

from tasks.services.graph import find_path, would_create_cycle


class FindPathTest(SimpleTestCase):
    def test_direct_edge(self):
        self.assertEqual(find_path([("a", "b")], "a", "b"), ["a", "b"])

    def test_transitive_path(self):
        edges = [("a", "b"), ("b", "c"), ("c", "d")]
        self.assertEqual(find_path(edges, "a", "d"), ["a", "b", "c", "d"])

    def test_no_path_against_edge_direction(self):
        self.assertIsNone(find_path([("a", "b")], "b", "a"))

    def test_no_path_between_disconnected_nodes(self):
        edges = [("a", "b"), ("c", "d")]
        self.assertIsNone(find_path(edges, "a", "d"))

    def test_path_to_self_is_trivial(self):
        self.assertEqual(find_path([], "a", "a"), ["a"])

    def test_shortest_path_is_preferred(self):
        edges = [("a", "b"), ("b", "c"), ("a", "c")]
        self.assertEqual(find_path(edges, "a", "c"), ["a", "c"])


class WouldCreateCycleTest(SimpleTestCase):
    def test_edge_into_empty_graph_is_fine(self):
        self.assertIsNone(would_create_cycle([], ("a", "b")))

    def test_diamond_is_not_a_cycle(self):
        edges = [("a", "b"), ("a", "c"), ("b", "d")]
        self.assertIsNone(would_create_cycle(edges, ("c", "d")))

    def test_self_edge_is_a_cycle(self):
        self.assertEqual(would_create_cycle([], ("a", "a")), ["a", "a"])

    def test_direct_back_edge(self):
        self.assertEqual(would_create_cycle([("a", "b")], ("b", "a")), ["a", "b", "a"])

    def test_transitive_cycle_reports_full_path(self):
        # Existing chain a -> b -> c; adding c -> a closes the loop.
        edges = [("a", "b"), ("b", "c")]
        self.assertEqual(would_create_cycle(edges, ("c", "a")), ["a", "b", "c", "a"])

    def test_duplicate_edge_is_not_a_cycle(self):
        self.assertIsNone(would_create_cycle([("a", "b")], ("a", "b")))
