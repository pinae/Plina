"""Demo data: the Mara story from the development plan (§3 user story).

Two projects — the deadline-driven "Webshop Relaunch" chain (with a diamond)
and the loosely coupled "Company Blog" — plus tagged recurring buckets and a
fixed Thursday client call.  Running this on a fresh database sets the stage
for the full walkthrough: plan → choose → track → complete → choose again.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from tasks.models import (Plan, Project, Tag, Task, TaskDependency,
                          TimeBucket, TimeBucketType, TrackingSession)


class Command(BaseCommand):
    help = 'Populates the database with the Mara-story demo data'

    def handle(self, *args, **kwargs):
        self.stdout.write("Populating demo data...")

        for model in (TrackingSession, Plan, TaskDependency, Task, Project,
                      TimeBucket, TimeBucketType, Tag):
            model.objects.all().delete()

        now = timezone.localtime()

        tag_deep = Tag.objects.create(name="deep-work", color=b'\x33\x57\xFF')
        tag_writing = Tag.objects.create(name="writing", color=b'\x8e\x44\xad')
        tag_meeting = Tag.objects.create(name="meeting", color=b'\xFF\x57\x33')

        webshop = Project.objects.create(name="Webshop Relaunch", priority=9.0)
        blog = Project.objects.create(name="Company Blog", priority=5.0)

        def task(header, hours, priority, project=None, tag=None, **kwargs):
            created = Task.objects.create(
                header=header, duration=timedelta(hours=hours),
                priority=priority, **kwargs,
            )
            if project:
                project.add(created)
            if tag:
                created.tags.add(tag)
            return created

        # Webshop Relaunch: chain with a diamond, hard deadline in 3 weeks.
        schema = task("Design schema", 4, 9.0, webshop, tag_deep)
        api = task("Implement API", 8, 9.0, webshop, tag_deep)
        checkout = task("Build checkout UI", 6, 8.0, webshop)
        payment = task("Payment integration", 6, 8.0, webshop)
        load_test = task("Load test", 4, 7.0, webshop,
                         latest_finish_date=now + timedelta(days=21))

        # Company Blog: one dependency, two independent articles.
        research = task("Research CMS options", 3, 6.0, blog, tag_writing)
        compare = task("Write CMS comparison", 4, 6.0, blog, tag_writing)
        task("Article: Scheduling like a CPU", 3, 5.0, blog, tag_writing)
        task("Article: The joy of fluid planning", 3, 4.0, blog, tag_writing)

        for predecessor, successor in [
            (schema, api), (api, checkout), (checkout, payment),
            (api, payment),                       # the diamond arm
            (payment, load_test), (research, compare),
        ]:
            TaskDependency.objects.create(predecessor=predecessor,
                                          successor=successor)

        # Recurring capacity (per the story: mornings deep, afternoons open,
        # Tuesday evening for writing).
        mornings = TimeBucketType.objects.create(
            name="Weekday Mornings", start_times="every weekday at 09:00",
            duration=timedelta(hours=4), color=b'\x33\x57\xFF')
        mornings.tags.add(tag_deep)
        TimeBucketType.objects.create(
            name="Weekday Afternoons", start_times="every weekday at 14:00",
            duration=timedelta(hours=3), color=b'\x53\x9d\xad')
        writing_evening = TimeBucketType.objects.create(
            name="Tuesday Writing", start_times="every tuesday at 19:00",
            duration=timedelta(hours=2), color=b'\x8e\x44\xad')
        writing_evening.tags.add(tag_writing)

        # The fixed Thursday client call (appointment: ignores buckets).
        days_until_thursday = (3 - now.weekday()) % 7 or 7
        call = task(
            "Client call", 1, 5.0, tag=tag_meeting, is_appointment=True,
            start_date=(now + timedelta(days=days_until_thursday)).replace(
                hour=10, minute=0, second=0, microsecond=0),
        )
        call.description = "Weekly sync with the webshop client."
        call.save()

        self.stdout.write(self.style.SUCCESS('Successfully populated demo data'))
