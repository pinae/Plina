"""Migration 0018: like tasks (0017), bucket types lose the teal default as
a "chosen" color and get distinct automatic colors."""
from datetime import timedelta

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("tasks", "0017_task_auto_color")]
AFTER = [("tasks", "0018_timebuckettype_auto_color")]
TEAL = b"\x53\x9d\xad"


class BucketColorMigrationTest(TransactionTestCase):
    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def setUp(self):
        Type = self.migrate(BEFORE).get_model("tasks", "TimeBucketType")
        self.mornings = Type.objects.create(name="Mornings", duration=timedelta(hours=4))  # teal
        self.evenings = Type.objects.create(name="Evenings", duration=timedelta(hours=2))
        self.chosen = Type.objects.create(name="Chosen", duration=timedelta(hours=1),
                                          color=b"\x11\x22\x33")

    def tearDown(self):
        executor = MigrationExecutor(connection)
        self.migrate([("tasks", executor.loader.graph.leaf_nodes("tasks")[0][1])])

    def test_forward(self):
        Type = self.migrate(AFTER).get_model("tasks", "TimeBucketType")
        mornings, evenings, chosen = (Type.objects.get(id=t.id)
                                      for t in (self.mornings, self.evenings, self.chosen))
        for bucket_type in (mornings, evenings):
            self.assertIsNone(bucket_type.color)
            self.assertIsNotNone(bucket_type.auto_color)
        self.assertNotEqual(bytes(mornings.auto_color), bytes(evenings.auto_color))
        self.assertEqual(bytes(chosen.color), b"\x11\x22\x33")
        self.assertIsNotNone(chosen.auto_color)

    def test_backward_restores_the_default(self):
        self.migrate(AFTER)
        Type = self.migrate(BEFORE).get_model("tasks", "TimeBucketType")
        self.assertEqual(bytes(Type.objects.get(id=self.mornings.id).color), TEAL)
        self.assertEqual(bytes(Type.objects.get(id=self.chosen.id).color), b"\x11\x22\x33")
