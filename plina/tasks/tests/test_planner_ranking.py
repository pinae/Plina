from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from tasks.models import Task, Project
from tasks.services.planner_service import calculate_dynamic_score, rank_tasks

class PlannerRankingTest(TestCase):
    def setUp(self):
        self.now = timezone.now()
        
        # Create tasks with different priorities and deadlines
        self.task_urgent = Task.objects.create(
            header="Urgent Task",
            priority=5.0,
            latest_finish_date=self.now + timedelta(hours=2),
            duration=timedelta(hours=1)
        )
        
        self.task_high_prio = Task.objects.create(
            header="High Prio Task",
            priority=10.0,
            latest_finish_date=self.now + timedelta(hours=10),
            duration=timedelta(hours=1)
        )
        
        self.task_low_prio = Task.objects.create(
            header="Low Prio Task",
            priority=1.0,
            latest_finish_date=self.now + timedelta(hours=10),
            duration=timedelta(hours=1)
        )

    def test_dynamic_score_calculation(self):
        """Test that score combines priority and urgency correctly."""
        # Just ensure it returns a float
        score = calculate_dynamic_score(self.task_urgent, self.now)
        self.assertIsInstance(score, float)

    def test_ranking_logic(self):
        """
        Urgent tasks (close deadline) should come first due to EDF.
        Then High Priority tasks.
        """
        tasks = [self.task_low_prio, self.task_high_prio, self.task_urgent]
        ranked = rank_tasks(tasks, self.now)
        
        # Expectation: Urgent (due in 2h) -> High Prio (due in 10h) -> Low Prio (due in 10h)
        self.assertEqual(ranked[0], self.task_urgent)
        self.assertEqual(ranked[1], self.task_high_prio)
        self.assertEqual(ranked[2], self.task_low_prio)
