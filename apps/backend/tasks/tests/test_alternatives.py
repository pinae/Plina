from datetime import timedelta

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from tasks.models import Project, Task, TimeBucket, TimeBucketType
from tasks.services.alternatives import generate_alternatives
from tasks.services.planner_service import UNBUCKETED, build_planning_tasks


def assert_topologically_valid(testcase, alternative, edges):
    """Every plan must be a valid topological ordering: for each edge (p, s)
    with both tasks planned, p's last slice ends no later than s' first starts."""
    first_start, last_finish = {}, {}
    for items in alternative.plan.values():
        for item in items:
            task_id = item.task.id
            end = item.start_time + item.duration
            if task_id not in first_start or item.start_time < first_start[task_id]:
                first_start[task_id] = item.start_time
            if task_id not in last_finish or end > last_finish[task_id]:
                last_finish[task_id] = end
    for predecessor, successor in edges:
        if predecessor in last_finish and successor in first_start:
            testcase.assertLessEqual(
                last_finish[predecessor], first_start[successor],
                f"{alternative.label}: edge {predecessor} -> {successor} violated",
            )


class AlternativesEngineTest(TestCase):
    def setUp(self):
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)
        self.bucket_type = TimeBucketType.objects.create(
            name="General", duration=timedelta(hours=4)
        )
        self.buckets = [
            TimeBucket.objects.create(
                start_date=self.now + timedelta(days=i, hours=1),
                duration=timedelta(hours=4),
                type=self.bucket_type,
            )
            for i in range(10)
        ]

    def chain(self, project_name: str, headers: list, **task_kwargs):
        project = Project.objects.create(name=project_name)
        tasks = []
        for header in headers:
            task = Task.objects.create(
                header=header, duration=timedelta(hours=2), **task_kwargs
            )
            project.add(task)
            tasks.append(task)
        edges = [(a.id, b.id) for a, b in zip(tasks, tasks[1:])]
        return project, tasks, edges

    def generate(self, edges, **kwargs):
        snapshots = build_planning_tasks(
            Task.objects.filter(completed_at=None).prefetch_related("tags")
        )
        return generate_alternatives(
            snapshots, self.buckets, edges, self.now, **kwargs
        )

    def test_two_disjoint_chains_yield_a_real_choice(self):
        _, tasks_a, edges_a = self.chain("Webshop", ["A1", "A2"])
        _, tasks_b, edges_b = self.chain("Blog", ["B1", "B2"])

        alternatives = self.generate(edges_a + edges_b)

        self.assertGreaterEqual(len(alternatives), 2)
        first_tasks = set()
        for alternative in alternatives:
            items = [i for items in alternative.plan.values() for i in items]
            first_tasks.add(min(items, key=lambda i: i.start_time).task.header)
        self.assertGreaterEqual(len(first_tasks), 2)

    def test_single_chain_yields_exactly_one_alternative(self):
        _, tasks, edges = self.chain("Solo", ["S1", "S2", "S3"])

        alternatives = self.generate(edges)

        self.assertEqual(len(alternatives), 1)

    def test_every_alternative_is_topologically_valid(self):
        _, _, edges_a = self.chain("Webshop", ["A1", "A2", "A3"])
        _, _, edges_b = self.chain("Blog", ["B1", "B2"])
        # Add a diamond inside Webshop-like structure across chains? Keep DAG:
        edges = edges_a + edges_b

        alternatives = self.generate(edges)

        self.assertGreaterEqual(len(alternatives), 2)
        for alternative in alternatives:
            assert_topologically_valid(self, alternative, edges)

    def test_infeasible_deadline_is_flagged_with_warning(self):
        _, tasks, edges = self.chain("Rush", ["R1", "R2"])
        rushed = tasks[-1]
        rushed.latest_finish_date = self.now + timedelta(hours=2)  # impossible
        rushed.save()

        alternatives = self.generate(edges)

        self.assertEqual(len(alternatives), 1)
        alternative = alternatives[0]
        self.assertFalse(alternative.feasible)
        warned_ids = [warning.task_id for warning in alternative.warnings]
        self.assertIn(rushed.id, warned_ids)

    def test_metrics_report_projected_finish_per_project(self):
        project_a, _, edges_a = self.chain("Webshop", ["A1", "A2"])
        project_b, _, edges_b = self.chain("Blog", ["B1"])

        alternatives = self.generate(edges_a + edges_b)

        metrics = alternatives[0].metrics
        self.assertIn(project_a.id, metrics.project_finishes)
        self.assertIn(project_b.id, metrics.project_finishes)
        self.assertGreater(metrics.project_finishes[project_a.id], self.now)
        self.assertGreaterEqual(metrics.context_switches, 0)

    def test_min_slack_metric_is_computed(self):
        _, tasks, edges = self.chain("Deadlined", ["D1", "D2"])
        tasks[-1].latest_finish_date = self.now + timedelta(days=5)
        tasks[-1].save()

        alternatives = self.generate(edges)

        self.assertIsNotNone(alternatives[0].metrics.min_slack)
        self.assertGreater(alternatives[0].metrics.min_slack, timedelta(0))

    def test_cap_is_respected_even_with_many_branches(self):
        self.assertEqual(settings.MAX_PLAN_ALTERNATIVES, 4)
        edges = []
        for name in ["P1", "P2", "P3", "P4", "P5"]:
            _, _, chain_edges = self.chain(name, [f"{name}-a", f"{name}-b"])
            edges += chain_edges

        alternatives = self.generate(edges)

        self.assertLessEqual(len(alternatives), settings.MAX_PLAN_ALTERNATIVES)
        self.assertGreaterEqual(len(alternatives), 2)

    def test_alternatives_carry_distinct_labels(self):
        _, _, edges_a = self.chain("Webshop", ["A1", "A2"])
        _, _, edges_b = self.chain("Blog", ["B1", "B2"])

        alternatives = self.generate(edges_a + edges_b)

        labels = [alternative.label for alternative in alternatives]
        self.assertEqual(len(labels), len(set(labels)))
        self.assertTrue(all(labels))


class AlternativesApiTest(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.now = timezone.now()
        TimeBucketType.objects.create(
            name="Daily", start_times="every day at 09:00",
            duration=timedelta(hours=4),
        )
        for name, headers in [("Webshop", ["A1", "A2"]), ("Blog", ["B1", "B2"])]:
            project = Project.objects.create(name=name)
            previous = None
            for header in headers:
                task = Task.objects.create(header=header, duration=timedelta(hours=2))
                project.add(task)
                if previous is not None:
                    from tasks.models import TaskDependency
                    TaskDependency.objects.create(predecessor=previous, successor=task)
                previous = task

    def test_alternatives_endpoint(self):
        response = self.client.get("/api/plan/alternatives/")

        self.assertEqual(response.status_code, 200)
        alternatives = response.data["alternatives"]
        self.assertGreaterEqual(len(alternatives), 2)
        for alternative in alternatives:
            self.assertIn("label", alternative)
            self.assertIn("feasible", alternative)
            self.assertIn("warnings", alternative)
            self.assertIn("min_slack_seconds", alternative["metrics"])
            self.assertIn("context_switches", alternative["metrics"])
            # Only non-empty buckets travel over the wire in the chooser payload.
            for bucket in alternative["buckets"]:
                self.assertTrue(bucket["items"])
        project_names = {
            finish["name"]
            for finish in alternatives[0]["metrics"]["project_finishes"]
        }
        self.assertEqual(project_names, {"Webshop", "Blog"})


class SelectionPrefersFeasiblePlansTest(TestCase):
    """Spec §6 Phase 3: feasible plans are preferred outright — an infeasible
    plan may never displace a feasible one just for being more 'diverse'."""

    def _alternative(self, label, ordering, feasible):
        from tasks.services.alternatives import (PlanAlternative, PlanMetrics,
                                                 PlanWarning)
        warnings = [] if feasible else [
            PlanWarning(task_id=label, header=label, kind="deadline_missed")
        ]
        return PlanAlternative(
            label=label, plan={}, ordering=ordering,
            metrics=PlanMetrics(min_slack=None, context_switches=0,
                                priority_earliness_hours=0.0, project_finishes={}),
            warnings=warnings,
        )

    def test_infeasible_plan_cannot_displace_a_feasible_one(self):
        from tasks.services.alternatives import _select
        feasible = [
            self._alternative(f"F{i}", ("a", "b", "c"), feasible=True)
            for i in range(3)
        ]
        # Maximally different ordering, but infeasible.
        wildcard = self._alternative("W", ("z", "y", "x"), feasible=False)

        selected = _select(feasible + [wildcard], cap=3)

        self.assertEqual(len(selected), 3)
        self.assertTrue(all(alternative.feasible for alternative in selected))

    def test_infeasible_plans_fill_leftover_slots(self):
        from tasks.services.alternatives import _select
        alternatives = [
            self._alternative("F1", ("a", "b"), feasible=True),
            self._alternative("W1", ("b", "a"), feasible=False),
            self._alternative("W2", ("a", "c"), feasible=False),
        ]

        selected = _select(alternatives, cap=2)

        self.assertEqual(len(selected), 2)
        self.assertTrue(selected[0].feasible)


class CapacityMismatchWarningTest(TestCase):
    def setUp(self):
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)

    def test_task_without_matching_capacity_is_flagged(self):
        from tasks.models import Tag
        deep = Tag.objects.create(name="deep")
        tagged_type = TimeBucketType.objects.create(
            name="Tagged only", duration=timedelta(hours=4)
        )
        tagged_type.tags.add(Tag.objects.create(name="other"))
        TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=1),
            duration=timedelta(hours=4), type=tagged_type,
        )
        stuck = Task.objects.create(header="Stuck", duration=timedelta(hours=1))
        stuck.tags.add(deep)

        snapshots = build_planning_tasks(Task.objects.all())
        alternatives = generate_alternatives(
            snapshots, list(TimeBucket.objects.all()), [], self.now
        )

        self.assertEqual(len(alternatives), 1)
        alternative = alternatives[0]
        self.assertFalse(alternative.feasible)
        self.assertEqual(alternative.warnings[0].kind, "unplanned_within_horizon")
        self.assertEqual(alternative.warnings[0].header, "Stuck")


class AllocationConfigQuantumTest(TestCase):
    """The flow preset's larger quantum must actually skip small gaps."""

    def test_larger_min_slice_skips_small_gaps(self):
        from tasks.services.planner_service import AllocationConfig, allocate_tasks
        now = timezone.now()
        bucket_type = TimeBucketType.objects.create(
            name="Tiny", duration=timedelta(minutes=20)
        )
        bucket = TimeBucket.objects.create(
            start_date=now + timedelta(hours=1),
            duration=timedelta(minutes=20), type=bucket_type,
        )
        long_task = Task.objects.create(header="Long", duration=timedelta(hours=2))

        default_plan = allocate_tasks([bucket], [long_task])
        flow_plan = allocate_tasks(
            [bucket], [long_task],
            config=AllocationConfig(min_task_slice=timedelta(minutes=30)),
        )

        self.assertEqual(len(default_plan[bucket.id]), 1)  # 20m slice allowed
        self.assertEqual(flow_plan[bucket.id], [])         # too small for flow
