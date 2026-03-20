from django.contrib import admin
from .models import Tag, Project, Task, ProjectTaskItem, TimeBucketType, TimeBucket


class ProjectRelationInline(admin.StackedInline):
    model = ProjectTaskItem
    fields = ('project', 'order',)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    pass


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    inlines = [ProjectRelationInline]


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    pass


@admin.register(TimeBucketType)
class TimeBucketTypeAdmin(admin.ModelAdmin):
    pass


@admin.register(TimeBucket)
class TimeBucketAdmin(admin.ModelAdmin):
    pass


#admin.site.register(Task, TaskAdmin)
