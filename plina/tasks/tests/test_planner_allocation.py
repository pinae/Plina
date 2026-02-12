from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from tasks.models import Task, TimeBucket, TimeBucketType, Tag
from tasks.services.planner_service import allocate_tasks

class PlannerAllocationTest(TestCase):
    def setUp(self):
        self.now = timezone.now()
        
        # Tags
        self.coding_tag = Tag.objects.create(name="coding")
        self.meeting_tag = Tag.objects.create(name="meeting")
        
        # Tasks
        self.task_coding = Task.objects.create(
            header="Coding Task", duration=timedelta(hours=1)
        )
        self.task_coding.tags.add(self.coding_tag)
        
        self.task_meeting = Task.objects.create(
            header="Meeting Task", duration=timedelta(hours=1)
        )
        self.task_meeting.tags.add(self.meeting_tag)
        
        self.task_general = Task.objects.create(
            header="General Task", duration=timedelta(hours=1)
        )

        # Bucket Types
        self.coding_bucket_type = TimeBucketType.objects.create(name="Coding Time")
        self.coding_bucket_type.tags.add(self.coding_tag)
        
        self.general_bucket_type = TimeBucketType.objects.create(name="General Time")

    def test_affinity_tag_match(self):
        """Coding bucket should prefer coding tasks."""
        bucket = TimeBucket.objects.create(
            start_date=self.now, duration=timedelta(hours=2), type=self.coding_bucket_type
        )
        
        tasks = [self.task_general, self.task_coding] # General comes first in list
        
        plan = allocate_tasks([bucket], tasks)
        
        # Expectation: Coding task allocated to Coding bucket, General task skipped or later?
        # Requirement: "Yes: Only consider tasks that share at least one tag"
        # So General Task should NOT be in Coding Bucket.
        
        bucket_plan = plan.get(bucket.id, [])
        self.assertEqual(len(bucket_plan), 1)
        self.assertEqual(bucket_plan[0].task, self.task_coding)

    def test_affinity_general_bucket(self):
        """General bucket accepts all tasks."""
        bucket = TimeBucket.objects.create(
            start_date=self.now, duration=timedelta(hours=2), type=self.general_bucket_type
        )
        
        tasks = [self.task_coding, self.task_general]
        
        plan = allocate_tasks([bucket], tasks)
        


    def test_stickiness(self):
        """Task from previous bucket should be preferred if compatible."""
        bucket1 = TimeBucket.objects.create(
            start_date=self.now, duration=timedelta(hours=1), type=self.general_bucket_type
        )
        bucket2 = TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=1), duration=timedelta(hours=1), type=self.general_bucket_type
        )
        
        # Task that takes 1.5 hours
        long_task = Task.objects.create(header="Long Task", duration=timedelta(hours=1.5), priority=5.0)
        # Another task
        other_task = Task.objects.create(header="Other Task", duration=timedelta(hours=0.5), priority=5.0)
        
        # We manually rank them so Long Task is first
        tasks = [long_task, other_task]
        
        plan = allocate_tasks([bucket1, bucket2], tasks)
        
        # Bucket 1 should have 1h of Long Task
        b1_items = plan.get(bucket1.id, [])
        self.assertEqual(len(b1_items), 1)
        self.assertEqual(b1_items[0].task, long_task)
        
        # Bucket 2 should have 0.5h of Long Task (continued), then Other Task
        b2_items = plan.get(bucket2.id, [])
        self.assertTrue(len(b2_items) >= 1)
        self.assertEqual(b2_items[0].task, long_task)

    def test_min_slice(self):
        """Do not schedule task if remaining space < MIN_TASK_SLICE."""
        bucket = TimeBucket.objects.create(
            start_date=self.now, duration=timedelta(minutes=14), type=self.general_bucket_type
        )
        long_task = Task.objects.create(header="Long Task", duration=timedelta(minutes=30))
        
        plan = allocate_tasks([bucket], [long_task])
        
        # Should not fit because bucket < 15 mins and task > bucket
        self.assertEqual(len(plan.get(bucket.id, [])), 0)


    def test_deadline_warning(self):
        """Should flag warning if scheduled time exceeds deadline."""
        bucket = TimeBucket.objects.create(
            start_date=self.now, duration=timedelta(hours=2), type=self.general_bucket_type
        )
        task = Task.objects.create(
            header="Late Task", 
            duration=timedelta(hours=1),
            latest_finish_date=self.now + timedelta(minutes=30)
        )
        
        plan = allocate_tasks([bucket], [task])
        items = plan.get(bucket.id, [])
        self.assertEqual(len(items), 1)
        self.assertTrue(hasattr(items[0], 'warnings'))
        self.assertIn("Deadline exceeded", items[0].warnings)

