"""Run every request in the user's time zone (``UserSettings.time_zone``), so
recurrence rules and times in messages mean the user's wall-clock time."""
from django.utils import timezone

from tasks.services.settings import user_time_zone


class UserTimeZoneMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        zone = user_time_zone()
        if zone is None:
            timezone.deactivate()
            return self.get_response(request)
        with timezone.override(zone):
            return self.get_response(request)
