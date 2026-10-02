"""UI-1: projects migrate into the task tree and back (round trip)."""
from datetime import timedelta

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("tasks", "0011_task_tree")]
AFTER = [("tasks", "0012_projects_to_task_tree")]


class ProjectMigrationTest(TransactionTestCase):
    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def setUp(self):
        apps = self.migrate(BEFORE)
        Project = apps.get_model("tasks", "Project")
        Task = apps.get_model("tasks", "Task")
        Item = apps.get_model("tasks", "ProjectTaskItem")
        Tag = apps.get_model("tasks", "Tag")

        self.maker = Tag.objects.create(name="maker")
        self.webshop = Project.objects.create(name="Webshop", description="Relaunch",
                                              priority=9.0, order=0, color=b"\x11\x22\x33")
        self.webshop.tags.add(self.maker)
        self.blog = Project.objects.create(name="Blog", priority=5.0, order=1)
        self.schema = Task.objects.create(header="Schema", duration=timedelta(hours=4))
        self.api = Task.objects.create(header="API", duration=timedelta(hours=8))
        self.article = Task.objects.create(header="Article")  # unestimated
        self.loose = Task.objects.create(header="Loose task", duration=timedelta(hours=1))
        Item.objects.create(project=self.webshop, task=self.api, order=1)
        Item.objects.create(project=self.webshop, task=self.schema, order=0)
        Item.objects.create(project=self.blog, task=self.article, order=0)

    def tearDown(self):
        self.migrate([("tasks", self._latest())])

    @staticmethod
    def _latest():
        executor = MigrationExecutor(connection)
        return executor.loader.graph.leaf_nodes("tasks")[0][1]

    def test_forward_turns_projects_into_top_level_tasks(self):
        apps = self.migrate(AFTER)
        Task = apps.get_model("tasks", "Task")
        Project = apps.get_model("tasks", "Project")

        webshop = Task.objects.get(id=self.webshop.id)  # the id survives
        self.assertEqual((webshop.header, webshop.description, webshop.priority),
                         ("Webshop", "Relaunch", 9.0))
        self.assertIsNone(webshop.parent_id)
        self.assertEqual(bytes(webshop.color), b"\x11\x22\x33")
        self.assertEqual(list(webshop.tags.values_list("name", flat=True)), ["maker"])
        # Estimate = sum of the parts, so nothing is over budget or has a Rest.
        self.assertEqual(webshop.duration, timedelta(hours=12))
        children = list(Task.objects.filter(parent=webshop).order_by("order")
                        .values_list("header", flat=True))
        self.assertEqual(children, ["Schema", "API"])

        blog = Task.objects.get(id=self.blog.id)
        self.assertEqual(blog.duration, timedelta(hours=1))  # unestimated part counts 1h
        self.assertEqual(Task.objects.get(id=self.article.id).parent_id, blog.id)
        self.assertIsNone(Task.objects.get(id=self.loose.id).parent_id)

        # Top-level order: projects first (their order), then loose tasks.
        top = list(Task.objects.filter(parent=None).order_by("order")
                   .values_list("header", flat=True))
        self.assertEqual(top, ["Webshop", "Blog", "Loose task"])
        self.assertEqual(Project.objects.count(), 0)

        Change = apps.get_model("tasks", "TaskEstimateChange")
        self.assertEqual(Change.objects.get(task_id=webshop.id).reason, "migrated")

    def test_backward_restores_the_projects(self):
        self.migrate(AFTER)
        apps = self.migrate(BEFORE)
        Project = apps.get_model("tasks", "Project")
        Task = apps.get_model("tasks", "Task")
        Item = apps.get_model("tasks", "ProjectTaskItem")

        webshop = Project.objects.get(id=self.webshop.id)
        self.assertEqual((webshop.name, webshop.priority, webshop.order), ("Webshop", 9.0, 0))
        self.assertEqual(list(webshop.tags.values_list("name", flat=True)), ["maker"])
        self.assertEqual(
            list(Item.objects.filter(project=webshop).order_by("order")
                 .values_list("task__header", flat=True)),
            ["Schema", "API"],
        )
        self.assertFalse(Task.objects.filter(id=self.webshop.id).exists())
        self.assertTrue(Task.objects.filter(id=self.loose.id).exists())
        self.assertEqual(Project.objects.count(), 2)
