"""Task colors over the API (docs/task-entry-ui.md §4.4).

``hex_color`` is the color a task shows, ``own_hex_color`` the one chosen for
it (null = inherit; on a top-level task: automatic), ``inherited_hex_color``
what it would show without its own.  Every top-level task has a color: one
without a chosen color gets an automatic one, as different as possible from
the colors in use, and keeps it when nested and moved back out.
"""
from datetime import timedelta

from django.test import TestCase
from rest_framework.test import APIClient

from tasks.models import Task, TimeBucketType

HEX = r"^#[0-9a-f]{6}$"
RED, BLUE = "#d03b3b", "#3357ff"


class TaskColorApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def post(self, **body):
        response = self.client.post("/api/tasks/", body, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def patch(self, task, **body):
        response = self.client.patch(f"/api/tasks/{task['id']}/", body, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def get(self, task):
        return self.client.get(f"/api/tasks/{task['id']}/").data

    def move(self, task, parent, index=0):
        response = self.client.post(f"/api/tasks/{task['id']}/move/", {
            "parent_id": parent["id"] if parent else None, "index": index,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["task"]

    def test_a_new_project_gets_an_automatic_color_unlike_the_others(self):
        webshop = self.post(header="Webshop")
        blog = self.post(header="Blog")
        self.assertRegex(webshop["hex_color"], HEX)
        self.assertIsNone(webshop["own_hex_color"])
        self.assertEqual(webshop["inherited_hex_color"], webshop["hex_color"])
        self.assertNotEqual(webshop["hex_color"], blog["hex_color"])
        # Stable: reading it again gives the same color.
        self.assertEqual(self.get(webshop)["hex_color"], webshop["hex_color"])

    def test_a_subtask_shows_its_projects_color(self):
        project = self.post(header="Project")
        child = self.post(header="Child", parent_id=project["id"])
        self.assertEqual(child["hex_color"], project["hex_color"])
        self.assertIsNone(child["own_hex_color"])
        self.assertEqual(child["inherited_hex_color"], project["hex_color"])

    def test_a_task_can_be_created_with_its_own_color(self):
        project = self.post(header="Project", own_hex_color=RED)
        self.assertEqual((project["hex_color"], project["own_hex_color"]), (RED, RED))
        # Its automatic color (what "Automatic" would show), not the teal fallback.
        self.assertRegex(project["inherited_hex_color"], HEX)
        self.assertNotIn(project["inherited_hex_color"], (RED, "#539dad"))
        automatic = project["inherited_hex_color"]
        self.assertEqual(self.patch(project, own_hex_color=None)["hex_color"], automatic)

    def test_choosing_and_clearing_colors(self):
        project = self.post(header="Project")
        automatic = project["hex_color"]
        child = self.post(header="Child", parent_id=project["id"])
        grandchild = self.post(header="Grandchild", parent_id=child["id"])

        child = self.patch(child, own_hex_color=RED)
        self.assertEqual((child["hex_color"], child["own_hex_color"]), (RED, RED))
        self.assertEqual(child["inherited_hex_color"], automatic)
        self.assertEqual(self.get(grandchild)["hex_color"], RED)

        project = self.patch(project, own_hex_color=BLUE)
        self.assertEqual(project["hex_color"], BLUE)
        self.assertEqual(self.get(child)["hex_color"], RED)  # its own color wins

        child = self.patch(child, own_hex_color=None)
        self.assertEqual(child["hex_color"], BLUE)
        self.assertEqual(self.get(grandchild)["hex_color"], BLUE)

        # Back to automatic: the same automatic color as before.
        project = self.patch(project, own_hex_color=None)
        self.assertEqual(project["hex_color"], automatic)

    def test_other_edits_keep_the_color(self):
        project = self.post(header="Project", own_hex_color=RED)
        project = self.patch(project, header="Renamed")
        self.assertEqual(project["own_hex_color"], RED)

    def test_malformed_colors_are_rejected(self):
        project = self.post(header="Project")
        response = self.client.patch(f"/api/tasks/{project['id']}/", {"own_hex_color": "red"},
                                     format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("#3357ff", str(response.data["own_hex_color"]))

    def test_a_project_moved_into_another_follows_it_and_gets_its_color_back_outside(self):
        a = self.post(header="A")
        b = self.post(header="B")
        own = b["hex_color"]

        nested = self.move(b, a)
        self.assertEqual(nested["hex_color"], a["hex_color"])

        back = self.move(nested, None)
        self.assertEqual(back["hex_color"], own)

    def test_a_subtask_moved_to_the_top_level_gets_an_automatic_color(self):
        project = self.post(header="Project")
        child = self.post(header="Child", parent_id=project["id"])
        moved = self.move(child, None)
        self.assertRegex(moved["hex_color"], HEX)
        self.assertNotEqual(moved["hex_color"], project["hex_color"])

    def test_patching_the_parent_away_gives_an_automatic_color(self):
        project = self.post(header="Project")
        child = self.post(header="Child", parent_id=project["id"])
        child = self.patch(child, parent_id=None)
        self.assertNotEqual(child["hex_color"], project["hex_color"])

    def test_lifted_subtasks_of_a_deleted_project_get_automatic_colors(self):
        project = self.post(header="Project")
        other = self.post(header="Other")
        child = self.post(header="Child", parent_id=project["id"])
        response = self.client.delete(f"/api/tasks/{project['id']}/?children=lift")
        self.assertEqual(response.status_code, 204)
        lifted = self.get(child)
        self.assertRegex(lifted["hex_color"], HEX)
        self.assertNotEqual(lifted["hex_color"], other["hex_color"])
        self.assertIsNotNone(Task.objects.get(id=child["id"]).auto_color)

    def test_plan_items_show_the_color_the_task_shows(self):
        TimeBucketType.objects.create(name="Daily", start_times="every day at 09:00",
                                      duration=timedelta(hours=4))
        project = self.post(header="Project", own_hex_color=BLUE)
        self.post(header="Step", parent_id=project["id"], duration="01:00:00")

        buckets = self.client.get("/api/plan/").data["buckets"]
        items = [item for bucket in buckets for item in bucket["items"]
                 if item["header"] == "Step"]
        self.assertTrue(items)
        self.assertEqual({item["hex_color"] for item in items}, {BLUE})
