from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Task, TimeBucket, TimeBucketType
from tasks.services.planner_service import UNBUCKETED, allocate_tasks


class PrePlacementTest(TestCase):
    """A8 semantics: appointments ignore buckets; anchored fixed tasks fill
    their bucket and split into following buckets if they don't fit."""

    def setUp(self):
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)
        self.bucket_type = TimeBucketType.objects.create(
            name="General", duration=timedelta(hours=4)
        )

    def bucket(self, hours_from_now: float, duration_hours: float = 4) -> TimeBucket:
        return TimeBucket.objects.create(
            start_date=self.now + timedelta(hours=hours_from_now),
            duration=timedelta(hours=duration_hours),
            type=self.bucket_type,
        )

    def appointment(self, header: str, hours_from_now: float, duration_hours: float) -> Task:
        return Task.objects.create(
            header=header,
            start_date=self.now + timedelta(hours=hours_from_now),
            duration=timedelta(hours=duration_hours),
            is_appointment=True,
        )

    def test_appointment_outside_any_bucket_is_still_placed(self):
        bucket = self.bucket(1)  # 4h bucket
        meeting = self.appointment("Evening call", hours_from_now=12, duration_hours=1)

        plan = allocate_tasks([bucket], [meeting])

        items = plan[UNBUCKETED]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].task, meeting)
        self.assertEqual(items[0].start_time, self.now + timedelta(hours=12))
        self.assertEqual(items[0].duration, timedelta(hours=1))

    def test_appointment_carves_capacity_out_of_overlapping_bucket(self):
        bucket = self.bucket(1)  # 4h: now+1h .. now+5h
        meeting = self.appointment("Standup", hours_from_now=2, duration_hours=1)
        work = Task.objects.create(header="Work", duration=timedelta(hours=3))

        plan = allocate_tasks([bucket], [meeting, work])

        work_items = sorted(
            (i for i in plan[bucket.id] if i.task == work), key=lambda i: i.start_time
        )
        # 1h before the meeting, 2h after it.
        self.assertEqual([(i.start_time, i.duration) for i in work_items], [
            (bucket.start_date, timedelta(hours=1)),
            (self.now + timedelta(hours=3), timedelta(hours=2)),
        ])
        # The appointment itself lives at calendar level, not inside the bucket.
        self.assertEqual([i.task for i in plan[UNBUCKETED]], [meeting])

    def test_anchored_fixed_task_splits_across_buckets(self):
        bucket1 = self.bucket(1)          # now+1 .. now+5
        bucket2 = self.bucket(24)         # next day
        anchored = Task.objects.create(
            header="Big fixed", duration=timedelta(hours=6),
            start_date=self.now + timedelta(hours=3),  # 2h left in bucket1
            is_fixed=True,
        )

        plan = allocate_tasks([bucket1, bucket2], [anchored])

        in_first = [i for i in plan[bucket1.id] if i.task == anchored]
        in_second = [i for i in plan[bucket2.id] if i.task == anchored]
        self.assertEqual([(i.start_time, i.duration) for i in in_first],
                         [(self.now + timedelta(hours=3), timedelta(hours=2))])
        self.assertEqual([(i.start_time, i.duration) for i in in_second],
                         [(bucket2.start_date, timedelta(hours=4))])

    def test_anchored_fixed_task_blocks_capacity_for_flexible_tasks(self):
        bucket = self.bucket(1)  # 4h
        anchored = Task.objects.create(
            header="Anchored", duration=timedelta(hours=2),
            start_date=bucket.start_date + timedelta(hours=1), is_fixed=True,
        )
        flexible = Task.objects.create(header="Flexible", duration=timedelta(hours=3))

        plan = allocate_tasks([bucket], [anchored, flexible])

        flexible_items = sorted(
            (i for i in plan[bucket.id] if i.task == flexible), key=lambda i: i.start_time
        )
        self.assertEqual([(i.start_time, i.duration) for i in flexible_items], [
            (bucket.start_date, timedelta(hours=1)),
            (bucket.start_date + timedelta(hours=3), timedelta(hours=1)),
        ])

    def test_appointment_acts_as_finish_to_start_predecessor(self):
        bucket = self.bucket(1)  # now+1 .. now+5
        meeting = self.appointment("Kickoff", hours_from_now=2, duration_hours=1)
        followup = Task.objects.create(header="Follow-up", duration=timedelta(hours=1))

        plan = allocate_tasks(
            [bucket], [meeting, followup], edges=[(meeting.id, followup.id)]
        )

        followup_items = [i for i in plan[bucket.id] if i.task == followup]
        self.assertEqual(len(followup_items), 1)
        # Eligible only after the meeting ends at now+3h.
        self.assertEqual(followup_items[0].start_time, self.now + timedelta(hours=3))


class IsAppointmentFieldTest(TestCase):
    def test_serializer_exposes_is_appointment(self):
        task = Task.objects.create(
            header="Call", start_date=timezone.now(), is_appointment=True
        )
        response = APIClient().get(f"/api/tasks/{task.id}/")
        self.assertTrue(response.data["is_appointment"])
