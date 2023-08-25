from django.db import models
from datetime import timedelta
from uuid import uuid4


class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    name = models.CharField(max_length=256)


class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    header = models.CharField(max_length=1024)
    description = models.TextField(default="")
    start_date = models.DateTimeField("start date", blank=True, null=True, default=None)
    duration = models.DurationField(blank=True, null=True, default=None)
    latest_finish_date = models.DateTimeField("due until", blank=True, null=True, default=None)
    time_spent = models.DurationField(default=timedelta(seconds=0))
    priority = models.FloatField(default=5.0)
    tags = models.ManyToManyField(to=Tag, related_name="tasks")

    @property
    def project(self):
        try:
            return self.project_item.project
        except Task.project_item.RelatedObjectDoesNotExist:
            return None

    @project.setter
    def set_project(self, project):
        project.add(self)


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    name = models.CharField(max_length=512)
    description = models.TextField(default="")
    tags = models.ManyToManyField(to=Tag, related_name="projects")
    priority = models.FloatField(default=5.0)
    order = models.PositiveIntegerField()

    def add(self, task):
        task_item = ProjectTaskItem(project=self, task=task, order=ProjectTaskItem.objects.filter(project=self).count())
        task_item.save()

    class Meta:
        ordering = ['order']


class ProjectTaskItem(models.Model):
    project = models.ForeignKey(to=Project, related_name="task_list", on_delete=models.CASCADE)
    task = models.OneToOneField(to=Task, related_name="project_item", on_delete=models.CASCADE)
    order = models.PositiveIntegerField()

    class Meta:
        ordering = ['order']
