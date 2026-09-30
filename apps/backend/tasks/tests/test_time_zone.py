"""Recurrence rules and messages follow the user's time zone, not the server's.

Regression: with the server on UTC, "every day at 14:00" produced buckets at
14:00 UTC — the bucket-type form's preview (and the Week view) showed them at
16:00 for a user in Berlin.
"""
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tasks.models import Task, TimeBucketType
from tasks.services.settings import get_settings

BERLIN = ZoneInfo("Europe/Berlin")


def set_time_zone(name: str) -> None:
    settings = get_settings()
    settings.time_zone = name
    settings.save()


class RecurrencePreviewTimeZoneTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def preview(self, start_times):
        response = self.client.post("/api/recurrence-preview/", {"start_times": start_times}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return [datetime.fromisoformat(value) for value in response.data["occurrences"]]

    def test_preview_uses_the_users_wall_clock_time(self):
        set_time_zone("Europe/Berlin")
        occurrences = self.preview("every day at 14:00")
        self.assertEqual(len(occurrences), 5)
        for occurrence in occurrences:
            local = occurrence.astimezone(BERLIN)
            self.assertEqual((local.hour, local.minute), (14, 0), occurrence)

    def test_without_a_time_zone_the_server_zone_applies(self):
        occurrences = self.preview("every day at 14:00")
        for occurrence in occurrences:
            self.assertEqual(occurrence.astimezone(ZoneInfo("UTC")).hour, 14)


class BucketGenerationTimeZoneTest(TestCase):
    def test_generated_buckets_keep_local_time_across_the_dst_change(self):
        # Berlin leaves summer time on Sunday, 25 Oct 2026 (UTC+2 → UTC+1).
        bucket_type = TimeBucketType.objects.create(
            name="Afternoon", start_times="every day at 14:00", duration=timedelta(hours=2))
        start = datetime(2026, 10, 24, 8, 0, tzinfo=BERLIN)
        with timezone.override(BERLIN):
            buckets = bucket_type.generate_buckets(generation_range=timedelta(days=3), start=start)
        utc = [b.start_date.astimezone(ZoneInfo("UTC")).strftime("%d %H:%M") for b in buckets]
        self.assertEqual(utc, ["24 12:00", "25 13:00", "26 13:00"])
        self.assertTrue(all(b.start_date.astimezone(BERLIN).hour == 14 for b in buckets))


class TimeZoneSettingTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_is_empty_by_default_and_can_be_set(self):
        self.assertEqual(self.client.get("/api/settings/").data["time_zone"], "")
        response = self.client.patch("/api/settings/", {"time_zone": "Europe/Berlin"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(get_settings().time_zone, "Europe/Berlin")

    def test_rejects_unknown_zones(self):
        response = self.client.patch("/api/settings/", {"time_zone": "Mars/Olympus_Mons"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("time_zone", response.data)

    def test_changing_it_replans_the_accepted_plan(self):
        with mock.patch("tasks.api.recalculate_accepted_plan") as recalculate:
            self.client.patch("/api/settings/", {"time_zone": "Europe/Berlin"}, format="json")
            self.assertEqual(recalculate.call_count, 1)
            # Sending the same zone again (every page load) changes nothing.
            self.client.patch("/api/settings/", {"time_zone": "Europe/Berlin"}, format="json")
            self.assertEqual(recalculate.call_count, 1)

    def test_messages_show_times_in_the_users_zone(self):
        set_time_zone("Europe/Berlin")
        parent = Task.objects.create(header="T250", latest_finish_date=datetime(2026, 10, 31, 23, 59, tzinfo=BERLIN))
        child = Task.objects.create(header="CAD", parent=parent)
        response = self.client.patch(f"/api/tasks/{child.id}/",
                                     {"latest_finish_date": "2026-11-05T12:00:00Z"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("(31.10.2026 23:59)", response.data["latest_finish_date"][0])
