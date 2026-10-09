"""Migration 0025: tracking no longer pins a task (docs/plan-chooser.md).

Tasks pinned by tracking — pinned at exactly the start of one of their
sessions — become free again; tasks placed by hand and appointments stay.
"""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("tasks", "0024_saved_filters")]
AFTER = [("tasks", "0025_unpin_tracked_tasks")]
START = datetime(2026, 10, 7, 9, 0, tzinfo=dt_timezone.utc)


class UnpinMigrationTest(TransactionTestCase):
    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def setUp(self):
        apps = self.migrate(BEFORE)
        User = apps.get_model("auth", "User")
        Task = apps.get_model("tasks", "Task")
        Session = apps.get_model("tasks", "TrackingSession")
        owner = User.objects.create(username="pina")

        def task(header, **fields):
            return Task.objects.create(owner=owner, header=header, **fields)

        self.tracked = task("Tracked", is_fixed=True, start_date=START)
        Session.objects.create(owner=owner, task=self.tracked, start=START, end=START + timedelta(hours=1))
        self.placed = task("Placed by hand", is_fixed=True, start_date=START + timedelta(days=1))
        Session.objects.create(owner=owner, task=self.placed, start=START, end=START + timedelta(hours=1))
        self.meeting = task("Meeting", is_fixed=True, is_appointment=True, start_date=START)
        Session.objects.create(owner=owner, task=self.meeting, start=START, end=START + timedelta(hours=1))

    def tearDown(self):
        executor = MigrationExecutor(connection)
        self.migrate([("tasks", executor.loader.graph.leaf_nodes("tasks")[0][1])])

    def test_forward(self):
        Task = self.migrate(AFTER).get_model("tasks", "Task")
        tracked, placed, meeting = (Task.objects.get(id=t.id) for t in (self.tracked, self.placed, self.meeting))
        self.assertEqual((tracked.is_fixed, tracked.start_date), (False, None))
        self.assertEqual((placed.is_fixed, placed.start_date), (True, START + timedelta(days=1)))
        self.assertEqual((meeting.is_fixed, meeting.start_date), (True, START))
