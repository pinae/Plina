from django.contrib import admin
from .models import (CalendarLink, CalendarSubscription, Marker, Tag, Task, TaskEstimateChange,
                     TimeBucketType, TimeBucket, UserSettings)


class EstimateChangeInline(admin.TabularInline):
    model = TaskEstimateChange
    extra = 0
    readonly_fields = ('changed_at', 'old_duration', 'new_duration', 'reason')


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    # Projects are top-level tasks (UI-1): the tree is edited via `parent`.
    list_display = ('header', 'parent', 'order', 'duration', 'time_spent', 'completed_at')
    list_filter = (('parent', admin.EmptyFieldListFilter),)
    inlines = [EstimateChangeInline]


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    pass


@admin.register(TimeBucketType)
class TimeBucketTypeAdmin(admin.ModelAdmin):
    pass


@admin.register(TimeBucket)
class TimeBucketAdmin(admin.ModelAdmin):
    pass


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ('default_duration', 'active_task')


@admin.register(Marker)
class MarkerAdmin(admin.ModelAdmin):
    list_display = ('title', 'start', 'duration')


@admin.register(CalendarSubscription)
class CalendarSubscriptionAdmin(admin.ModelAdmin):
    list_display = ('name', 'last_synced_at', 'last_error')
    exclude = ('url',)  # secret


@admin.register(CalendarLink)
class CalendarLinkAdmin(admin.ModelAdmin):
    list_display = ('subscription', 'uid', 'recurrence_id', 'task', 'marker', 'bucket_type', 'owned')
