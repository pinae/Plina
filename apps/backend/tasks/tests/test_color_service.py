"""Task colors (docs/task-entry-ui.md §4.4): a task shows its own color, else
its nearest ancestor's; a top-level task without one shows an automatic
color, chosen once to be as different as possible from the colors in use."""
import random

from django.test import SimpleTestCase
from tasks.tests.support import TestCase

from tasks.models import Tag, Task
from tasks.services.colors import (CANDIDATES, colors_in_use, contrast_with_white,
                                   distinct_color, ensure_auto_colors, oklab_distance)
from tasks.services.tree import TreeIndex

RED, BLUE, GREEN = "#d03b3b", "#3357ff", "#2e9e4f"


def rgb(hex_color):
    return bytes.fromhex(hex_color[1:])


def min_distance(color, others):
    return min(oklab_distance(color, other) for other in others)


class DistinctColorTest(SimpleTestCase):
    def test_without_colors_in_use_it_picks_a_random_candidate(self):
        picks = {distinct_color([], random.Random(seed)) for seed in range(20)}
        self.assertTrue(picks <= set(CANDIDATES))
        self.assertGreater(len(picks), 5)

    def test_picks_one_of_the_candidates_farthest_from_the_colors_in_use(self):
        used = [RED, BLUE]
        best = max(min_distance(candidate, used) for candidate in CANDIDATES)
        for seed in range(10):
            pick = distinct_color(used, random.Random(seed))
            self.assertGreaterEqual(min_distance(pick, used), 0.9 * best)

    def test_a_series_of_projects_stays_easy_to_tell_apart(self):
        # 0.02 in OKLab is about the smallest visible difference.
        for seed in range(30):
            rng, used = random.Random(seed), []
            for _ in range(8):
                used.append(distinct_color(used, rng))
            closest = min(oklab_distance(a, b) for i, a in enumerate(used) for b in used[i + 1:])
            self.assertGreater(closest, 0.07, f"seed {seed}: {used}")

    def test_white_text_stays_readable_on_every_candidate(self):
        # Week-view cards show white titles on the task color (WCAG 3:1 for large/bold text).
        self.assertGreater(len(CANDIDATES), 30)
        for color in CANDIDATES:
            self.assertGreaterEqual(contrast_with_white(color), 3.0, color)


class EffectiveColorTest(TestCase):
    def setUp(self):
        self.project = Task.objects.create(header="Project", auto_color=rgb(BLUE))
        self.part = Task.objects.create(header="Part", parent=self.project)
        self.step = Task.objects.create(header="Step", parent=self.part)

    def colors(self, task):
        tree = TreeIndex.load()
        return tree.effective_color(task.id), tree.inherited_color(task.id)

    def test_a_project_shows_its_automatic_color(self):
        self.assertEqual(self.colors(self.project), (BLUE, BLUE))

    def test_subtasks_inherit_from_the_nearest_ancestor_with_a_color(self):
        self.assertEqual(self.colors(self.step), (BLUE, BLUE))
        Task.objects.filter(id=self.part.id).update(color=rgb(RED))
        self.assertEqual(self.colors(self.part), (RED, BLUE))
        self.assertEqual(self.colors(self.step), (RED, RED))

    def test_an_own_color_wins(self):
        Task.objects.filter(id=self.step.id).update(color=rgb(GREEN))
        self.assertEqual(self.colors(self.step), (GREEN, BLUE))
        Task.objects.filter(id=self.project.id).update(color=rgb(RED))
        self.assertEqual(self.colors(self.project), (RED, BLUE))  # without it: automatic

    def test_a_nested_task_ignores_its_automatic_color(self):
        # It was a project once; inside another one it follows that project.
        was_project = Task.objects.create(header="Was a project", parent=self.project,
                                          auto_color=rgb(RED))
        self.assertEqual(self.colors(was_project), (BLUE, BLUE))


class EnsureAutoColorsTest(TestCase):
    def test_top_level_tasks_without_a_color_get_distinct_automatic_ones(self):
        a = Task.objects.create(header="A")
        b = Task.objects.create(header="B")
        child = Task.objects.create(header="Child", parent=a)
        chosen = Task.objects.create(header="Chosen", color=rgb(RED))

        self.assertEqual(ensure_auto_colors(random.Random(3)), 3)

        a, b, child, chosen = (Task.objects.get(id=t.id) for t in (a, b, child, chosen))
        self.assertIsNotNone(a.auto_color)
        self.assertIsNotNone(b.auto_color)
        self.assertNotEqual(bytes(a.auto_color), bytes(b.auto_color))
        self.assertIsNone(child.auto_color)  # subtasks inherit instead
        self.assertIsNotNone(chosen.auto_color)  # what "Automatic" would show
        # Also different from the chosen color in use.
        for task in (a, b):
            self.assertGreater(oklab_distance("#" + bytes(task.auto_color).hex(), RED), 0.07)

    def test_existing_automatic_colors_stay(self):
        a = Task.objects.create(header="A", auto_color=rgb(BLUE))
        self.assertEqual(ensure_auto_colors(), 0)
        self.assertEqual(bytes(Task.objects.get(id=a.id).auto_color), rgb(BLUE))

    def test_colors_in_use_are_the_ones_open_tasks_show(self):
        project = Task.objects.create(header="P", auto_color=rgb(BLUE))
        Task.objects.create(header="Own", parent=project, color=rgb(RED))
        Task.objects.create(header="Inherits", parent=project, auto_color=rgb(GREEN))
        Task.objects.create(header="Done", color=rgb(GREEN), completed_at="2026-01-01T00:00:00Z")
        self.assertEqual(sorted(colors_in_use()), sorted([BLUE, RED]))


class HexColorSetterTest(TestCase):
    def test_the_hex_color_setter_writes_the_rgb_bytes(self):
        tag = Tag(name="deep")
        tag.hex_color = "#3357FF"
        self.assertEqual(tag.color, b"\x33\x57\xff")
        tag.hex_color = None
        self.assertIsNone(tag.color)
