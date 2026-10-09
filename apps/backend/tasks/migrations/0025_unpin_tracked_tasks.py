"""Tracking no longer pins a task (docs/plan-chooser.md): plans put the
running task first by its session. Tasks pinned by tracking — at exactly the
start of one of their sessions — become free again; tasks placed by hand and
appointments keep their place."""
from django.db import migrations
from django.db.models import Exists, OuterRef


def unpin(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Session = apps.get_model("tasks", "TrackingSession")
    pinned_by_tracking = Session.objects.filter(task=OuterRef("pk"), start=OuterRef("start_date"))
    Task.objects.filter(is_fixed=True, is_appointment=False, start_date__isnull=False) \
        .filter(Exists(pinned_by_tracking)).update(is_fixed=False, start_date=None)


class Migration(migrations.Migration):
    dependencies = [("tasks", "0024_saved_filters")]

    operations = [migrations.RunPython(unpin, migrations.RunPython.noop)]
