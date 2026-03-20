from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from tasks.models import Task, Project, Tag, TimeBucket, TimeBucketType

class Command(BaseCommand):
    help = 'Populates the database with demo data'

    def handle(self, *args, **kwargs):
        self.stdout.write("Populating demo data...")
        
        # Cleanup
        Task.objects.all().delete()
        Project.objects.all().delete()
        Tag.objects.all().delete()
        TimeBucket.objects.all().delete()
        TimeBucketType.objects.all().delete()
        
        now = timezone.now()
        
        # Tags
        tag_coding = Tag.objects.create(name="coding", color=b'\x33\x57\xFF') # Blueish
        tag_meeting = Tag.objects.create(name="meeting", color=b'\xFF\x57\x33') # Reddish
        tag_general = Tag.objects.create(name="general", color=b'\x33\xFF\x57') # Greenish
        
        # Bucket Types
        bt_coding = TimeBucketType.objects.create(name="Deep Work", color=b'\x33\x57\xFF', duration=timedelta(hours=4))
        bt_coding.tags.add(tag_coding)
        
        bt_general = TimeBucketType.objects.create(name="General", color=b'\x33\xFF\x57', duration=timedelta(hours=4))
        
        # Buckets for next 2 days
        TimeBucket.objects.create(start_date=now + timedelta(hours=1), duration=timedelta(hours=3), type=bt_coding)
        TimeBucket.objects.create(start_date=now + timedelta(hours=5), duration=timedelta(hours=2), type=bt_general)
        TimeBucket.objects.create(start_date=now + timedelta(days=1, hours=9), duration=timedelta(hours=4), type=bt_coding)
        
        # Projects
        p_refactor = Project.objects.create(name="Refactor Backend", priority=9.0)
        p_frontend = Project.objects.create(name="Frontend Rewrite", priority=8.0)
        
        # Tasks
        t1 = Task.objects.create(
            header="Upgrade Django",
            priority=10.0,
            duration=timedelta(hours=2),
            latest_finish_date=now + timedelta(days=2))
        t1.tags.add(tag_coding)
        p_refactor.add(t1)
        
        t2 = Task.objects.create(
            header="Setup React",
            priority=8.0,
            duration=timedelta(minutes=45),
            latest_finish_date=now + timedelta(days=5))
        t2.tags.add(tag_coding)
        p_frontend.add(t2)
        
        t3 = Task.objects.create(
            header="Team Sync",
            priority=5.0,
            duration=timedelta(hours=1),
            is_fixed=True)
        t3.tags.add(tag_meeting)
        
        t4 = Task.objects.create(
            header="Write Documentation",
            priority=3.0,
            duration=timedelta(minutes=30))
        t4.tags.add(tag_general)
        
        self.stdout.write(self.style.SUCCESS('Successfully populated demo data'))
