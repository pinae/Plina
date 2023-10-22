from django.db import models
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from datetime import timedelta
from uuid import uuid4


class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    name = models.CharField(max_length=256)

    def __str__(self):
        return "#{}".format(self.name)


class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    header = models.CharField(max_length=1024)
    description = models.TextField(default="")
    start_date = models.DateTimeField("start date", blank=True, null=True, default=None)
    duration = models.DurationField(blank=True, null=True, default=None)
    latest_finish_date = models.DateTimeField("due until", blank=True, null=True, default=None)
    time_spent = models.DurationField(default=timedelta(seconds=0))
    priority = models.FloatField(default=5.0)
    tags = models.ManyToManyField(to=Tag, related_name="tasks", blank=True)

    def __str__(self):
        return "Task {}: {} ({:.2f})".format(str(self.id), self.header, self.priority)

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
    tags = models.ManyToManyField(to=Tag, related_name="projects", blank=True)
    priority = models.FloatField(default=5.0)
    order = models.PositiveIntegerField(default=0)

    def __str__(self):
        return "Project {}: {} ({:d}:{:.2f})".format(str(self.id), self.name, self.order, self.priority)

    def add(self, task):
        task_item = ProjectTaskItem(project=self, task=task, order=ProjectTaskItem.objects.filter(project=self).count())
        task_item.save()

    def insert(self, task, position=0):
        new_task_item = ProjectTaskItem(project=self, task=task, order=0)
        for i, pti in enumerate(ProjectTaskItem.objects.filter(project=self).order_by("order").all()):
            if i == position:
                new_task_item.order = pti.order
            if i >= position:
                pti.order = pti.order + 1
                pti.save()
        new_task_item.save()

    def remove(self, task):
        try:
            pti = ProjectTaskItem.objects.get(project=self, task=task)
            for subsequent_pti in ProjectTaskItem.objects.filter(project=self, order__gte=pti.order):
                subsequent_pti.order = subsequent_pti.order - 1
                subsequent_pti.save()
            pti.delete()
        except ProjectTaskItem.DoesNotExist:
            pass

    class Meta:
        ordering = ['order']


class ProjectTaskItem(models.Model):
    project = models.ForeignKey(to=Project, related_name="task_list", on_delete=models.CASCADE)
    task = models.OneToOneField(to=Task, related_name="project_item", on_delete=models.CASCADE)
    order = models.PositiveIntegerField()

    class Meta:
        ordering = ['order']


@receiver(pre_delete, sender=Task)
def pre_task_delete(sender, instance, using, **kwargs):
    for pti in ProjectTaskItem.objects.filter(task=instance).all():
        pti.project.remove(instance)
