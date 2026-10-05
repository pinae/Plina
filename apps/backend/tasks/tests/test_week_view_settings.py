"""The time frame the Week view opens on (the user's usual work hours):
08:00 to 16:45 unless set otherwise in the settings."""
from datetime import time

from django.test import TestCase
from rest_framework.test import APIClient

from tasks.services.settings import get_settings


class WeekViewSettingsTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def patch(self, **body):
        return self.client.patch("/api/settings/", body, format="json")

    def test_defaults_to_8_to_16_45(self):
        data = self.client.get("/api/settings/").data
        self.assertEqual((data["week_view_start"], data["week_view_end"]), ("08:00:00", "16:45:00"))

    def test_changing_the_time_frame(self):
        response = self.patch(week_view_start="07:30", week_view_end="18:00")
        self.assertEqual(response.status_code, 200, response.data)
        settings = get_settings()
        self.assertEqual((settings.week_view_start, settings.week_view_end), (time(7, 30), time(18, 0)))
        self.assertEqual(response.data["week_view_end"], "18:00:00")

    def test_the_end_must_be_after_the_start(self):
        response = self.patch(week_view_start="17:00", week_view_end="09:00")
        self.assertEqual(response.status_code, 400)
        self.assertIn("after", str(response.data["week_view_end"]))
        self.assertEqual(get_settings().week_view_start, time(8, 0))  # nothing saved

    def test_one_end_alone_is_checked_against_the_stored_other(self):
        response = self.patch(week_view_start="17:00")  # the stored end is 16:45
        self.assertEqual(response.status_code, 400)
        self.assertIn("week_view_end", response.data)
        self.assertEqual(self.patch(week_view_end="12:00").status_code, 200)

    def test_malformed_times_are_rejected(self):
        response = self.patch(week_view_start="8 o'clock")
        self.assertEqual(response.status_code, 400)
        self.assertIn("week_view_start", response.data)
