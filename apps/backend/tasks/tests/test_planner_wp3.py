from datetime import timedelta
from django.test import TestCase
from django.utils import timezone

from tasks.models import Task, TimeBucket, TimeBucketType, TaskDependency
from tasks.services.planner_service import allocate_tasks, PlanningTask
from tasks.services.graph import DependencyGraph


class WP3AllocationTest(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.bucket_type = TimeBucketType.objects.create(name="Deep Work")

    def _build_graph(self, tasks, edges):
        snapshots = [PlanningTask.from_task(t) for t in tasks]
        node_map = {s.id: s for s in snapshots}
        relevant_edges = [(p, s) for p, s in edges if p in node_map and s in node_map]
        return DependencyGraph(node_map, relevant_edges)

    def test_dependency_eligibility(self):
        """test: with A→B and one bucket, B is never allocated before A completes its remaining duration"""
        task_a = Task.objects.create(header="Task A", duration=timedelta(hours=1))
        task_b = Task.objects.create(header="Task B", duration=timedelta(hours=1))

        TaskDependency.objects.create(predecessor=task_a, successor=task_b)
        bucket = TimeBucket.objects.create(start_date=self.now, duration=timedelta(hours=2), type=self.bucket_type)

        tasks = [task_b, task_a]  # Intentionally reverse order to ensure graph logic prevents B first
        graph = self._build_graph(tasks, [(task_a.id, task_b.id)])

        plan = allocate_tasks([bucket], tasks, graph)
        bucket_plan = plan.get(bucket.id, [])

        # Per A3, Task B is not eligible in this bucket because Task A didn't finish strictly before the bucket started.
        self.assertEqual(len(bucket_plan), 1)
        self.assertEqual(bucket_plan[0].task, task_a)

    def test_fixed_task_splits_across_buckets(self):
        """test: fixed task exceeding its bucket splits into the next bucket"""
        fixed_task = Task.objects.create(header="Fixed", duration=timedelta(hours=3), is_fixed=True)

        bucket1 = TimeBucket.objects.create(start_date=self.now, duration=timedelta(hours=2), type=self.bucket_type)
        bucket2 = TimeBucket.objects.create(start_date=self.now + timedelta(hours=2), duration=timedelta(hours=2),
                                            type=self.bucket_type)

        graph = self._build_graph([fixed_task], [])
        plan = allocate_tasks([bucket1, bucket2], [fixed_task], graph)

        b1_items = plan.get(bucket1.id, [])
        b2_items = plan.get(bucket2.id, [])

        self.assertEqual(len(b1_items), 1)
        self.assertEqual(b1_items[0].duration, timedelta(hours=2))
        self.assertEqual(len(b2_items), 1)
        self.assertEqual(b2_items[0].duration, timedelta(hours=1))

    def test_appointment_reduces_usable_capacity(self):
        """test: appointment overlapping a bucket reduces usable capacity correctly"""
        # Appointment from now + 1h to now + 2h
        appointment = Task.objects.create(
            header="Appt", start_date=self.now + timedelta(hours=1), duration=timedelta(hours=1)
        )
        fluid_task = Task.objects.create(header="Fluid", duration=timedelta(hours=1.5))

        # Bucket spans from now to now + 2h
        bucket = TimeBucket.objects.create(start_date=self.now, duration=timedelta(hours=2), type=self.bucket_type)

        graph = self._build_graph([appointment, fluid_task], [])
        plan = allocate_tasks([bucket], [appointment, fluid_task], graph)

        b1_items = plan.get(bucket.id, [])
        appt_items = plan.get("appointments", [])

        self.assertEqual(len(appt_items), 1)
        self.assertEqual(appt_items[0].task, appointment)

        # Fluid task should only get 1 hour before the appointment blocks the rest of the bucket
        self.assertEqual(len(b1_items), 1)
        self.assertEqual(b1_items[0].task, fluid_task)
        self.assertEqual(b1_items[0].duration, timedelta(hours=1))

    def test_appointment_outside_bucket_is_placed(self):
        """test: appointment outside any bucket is still placed"""
        appointment = Task.objects.create(
            header="Appt Outside", start_date=self.now + timedelta(days=1), duration=timedelta(hours=1)
        )
        bucket = TimeBucket.objects.create(start_date=self.now, duration=timedelta(hours=2), type=self.bucket_type)

        graph = self._build_graph([appointment], [])
        plan = allocate_tasks([bucket], [appointment], graph)

        appt_items = plan.get("appointments", [])

        self.assertEqual(len(appt_items), 1)
        self.assertEqual(appt_items[0].task, appointment)
        self.assertEqual(appt_items[0].start_time, appointment.start_date)
