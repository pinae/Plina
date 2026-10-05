"""Every row gets an owner: Plina becomes multi-user (plina.scoping).

Existing data goes to the first superuser, else the first user, else to a
new user "plina" without a password (set one with
``manage.py changepassword plina``).
"""
import django.db.models.deletion
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import migrations, models

OWNED = ["tag", "task", "taskestimatechange", "taskdependency", "timebuckettype", "timebucket",
         "trackingsession", "plan", "planentry"]


def assign_owner(apps, schema_editor):
    models_ = [apps.get_model("tasks", name) for name in OWNED + ["usersettings"]]
    if not any(model.objects.exists() for model in models_):
        return
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    owner = (User.objects.filter(is_superuser=True).order_by("pk").first()
             or User.objects.order_by("pk").first())
    if owner is None:
        owner = User.objects.create(username="plina", password=make_password(None))
    for model in models_:
        if model._meta.model_name == "usersettings":
            # One row per user now; the old singleton becomes the owner's.
            first = model.objects.order_by("pk").first()
            model.objects.exclude(pk=first.pk).delete() if first else None
            model.objects.update(owner=owner)
        else:
            model.objects.update(owner=owner)


def owner_field(null):
    return models.ForeignKey(null=null, editable=False, on_delete=django.db.models.deletion.CASCADE,
                             related_name="+", to=settings.AUTH_USER_MODEL)


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0019_usersettings_week_view"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        *[migrations.AddField(model_name=name, name="owner", field=owner_field(null=True)) for name in OWNED],
        migrations.AddField(
            model_name="usersettings", name="owner",
            field=models.OneToOneField(null=True, editable=False, on_delete=django.db.models.deletion.CASCADE,
                                       related_name="plina_settings", to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(assign_owner, migrations.RunPython.noop),
        # A user's whole tree may go with them (children are deleted too).
        migrations.AlterField(
            model_name="task", name="parent",
            field=models.ForeignKey(blank=True, default=None, null=True, on_delete=django.db.models.deletion.RESTRICT,
                                    related_name="children", to="tasks.task"),
        ),
        *[migrations.AlterField(model_name=name, name="owner", field=owner_field(null=False)) for name in OWNED],
        migrations.AlterField(
            model_name="usersettings", name="owner",
            field=models.OneToOneField(editable=False, on_delete=django.db.models.deletion.CASCADE,
                                       related_name="plina_settings", to=settings.AUTH_USER_MODEL),
        ),
    ]
