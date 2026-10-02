"""Migration 0017: the teal default stops counting as a chosen color.

Before, every task got #539dad by default, so nothing could inherit. After,
those tasks have no own color (subtasks inherit), and every top-level task
gets a distinct automatic one.
"""
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("tasks", "0016_user_time_zone")]
AFTER = [("tasks", "0017_task_auto_color")]
TEAL = b"\x53\x9d\xad"


class ColorMigrationTest(TransactionTestCase):
    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def setUp(self):
        Task = self.migrate(BEFORE).get_model("tasks", "Task")
        self.webshop = Task.objects.create(header="Webshop", order=0)  # teal by default
        self.blog = Task.objects.create(header="Blog", order=1)
        self.chosen = Task.objects.create(header="Chosen", order=2, color=b"\x11\x22\x33")
        self.child = Task.objects.create(header="Child", parent=self.webshop)
        self.assertEqual(bytes(Task.objects.get(id=self.child.id).color), TEAL)

    def tearDown(self):
        executor = MigrationExecutor(connection)
        self.migrate([("tasks", executor.loader.graph.leaf_nodes("tasks")[0][1])])

    def test_forward(self):
        Task = self.migrate(AFTER).get_model("tasks", "Task")
        webshop, blog, chosen, child = (Task.objects.get(id=t.id) for t in
                                        (self.webshop, self.blog, self.chosen, self.child))
        self.assertIsNone(child.color)  # inherits from Webshop now
        self.assertIsNone(child.auto_color)
        for project in (webshop, blog):
            self.assertIsNone(project.color)
            self.assertIsNotNone(project.auto_color)
        self.assertNotEqual(bytes(webshop.auto_color), bytes(blog.auto_color))
        self.assertEqual(bytes(chosen.color), b"\x11\x22\x33")  # kept
        self.assertIsNotNone(chosen.auto_color)  # what "Automatic" would show

    def test_backward_restores_the_default(self):
        self.migrate(AFTER)
        Task = self.migrate(BEFORE).get_model("tasks", "Task")
        self.assertEqual(bytes(Task.objects.get(id=self.child.id).color), TEAL)
        self.assertEqual(bytes(Task.objects.get(id=self.chosen.id).color), b"\x11\x22\x33")
